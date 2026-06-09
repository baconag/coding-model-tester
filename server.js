const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3458;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_PATH = path.join(__dirname, 'providers-default.json');
const USER_PATH = path.join(__dirname, 'user-config.json');

function loadDefaults() {
  return JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf-8'));
}

function loadUserConfig() {
  if (!fs.existsSync(USER_PATH)) return { providers: {} };
  try { return JSON.parse(fs.readFileSync(USER_PATH, 'utf-8')); }
  catch (e) { console.error('user-config.json 解析失败:', e.message); return { providers: {} }; }
}

function saveUserConfig(cfg) {
  fs.writeFileSync(USER_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

// 合并 默认 + 用户配置 -> 运行时 provider 列表
function getMergedProviders() {
  const defaults = loadDefaults().providers;
  const user = loadUserConfig().providers || {};
  const out = {};
  for (const id of Object.keys(defaults)) {
    const d = defaults[id];
    const u = user[id] || {};
    const baseModels = (d.models || []).map(m => ({ ...m, extra: false }));
    const extraModels = (u.extraModels || []).filter(m => m && m.id).map(m => ({ ...m, extra: true }));
    const removed = new Set(u.removedModelIds || []);
    const allModels = [...baseModels, ...extraModels].filter(m => !removed.has(m.id));
    out[id] = {
      id,
      name: u.name || d.name,
      brand: d.brand || d.name,
      tags: Array.isArray(d.tags) ? d.tags.slice() : [],
      baseUrl: u.baseUrl || d.baseUrl,
      apiFormat: u.apiFormat || d.apiFormat,
      apiKey: u.apiKey || '',
      noAuth: !!d.noAuth,
      enabled: u.enabled !== undefined ? !!u.enabled : false,
      models: allModels
    };
  }
  // 用户新增的全自定义 provider
  for (const id of Object.keys(user)) {
    if (out[id]) continue;
    const u = user[id];
    out[id] = {
      id,
      name: u.name || id,
      brand: u.brand || u.name || id,
      tags: Array.isArray(u.tags) ? u.tags.slice() : [],
      baseUrl: u.baseUrl || '',
      apiFormat: u.apiFormat || 'openai',
      apiKey: u.apiKey || '',
      noAuth: !!u.noAuth,
      enabled: !!u.enabled,
      models: (u.extraModels || []).filter(m => m && m.id).map(m => ({ ...m, extra: true })),
      custom: true
    };
  }
  return out;
}

function buildEndpoint(provider) {
  // baseUrl 存完整 endpoint。Gemini 在其嵌套项外部拼接。
  return (provider.baseUrl || '').replace(/\/+$/, '');
}

// ============ OpenAI 协议流式 ============
async function testSingleRoundOpenAI(provider, model, prompt, timeoutMs) {
  const startTime = Date.now();
  let firstTokenTime = null, totalTokens = 0, fullText = '', error = null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const body = JSON.stringify({
      model, messages: [{ role: 'user', content: prompt }],
      stream: true, stream_options: { include_usage: true }, max_tokens: 4096
    });
    const headers = { 'Content-Type': 'application/json' };
    if (!provider.noAuth && provider.apiKey) headers['Authorization'] = 'Bearer ' + provider.apiKey;

    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(buildEndpoint(provider), { method: 'POST', headers, body, signal: ac.signal });
      if (res.status !== 429) break;
      if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      error = 'HTTP ' + res.status + (errBody ? ': ' + errBody.substring(0, 200) : '');
      clearTimeout(timer);
      return buildRound(startTime, null, 0, 0, error);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          if (json.error) {
            error = 'API: ' + (json.error.message || json.error.code || JSON.stringify(json.error)).substring(0, 200);
            break;
          }
          const delta = json.choices?.[0]?.delta;
          if (firstTokenTime === null && delta && (delta.role || delta.content || delta.reasoning_content)) firstTokenTime = Date.now();
          if (delta?.content) fullText += delta.content;
          if (delta?.reasoning_content) fullText += delta.reasoning_content;
          if (json.usage) totalTokens = json.usage.total_tokens || json.usage.completion_tokens || 0;
        } catch (e) {}
      }
      if (error) break;
    }
  } catch (err) {
    if (err.name === 'AbortError') error = 'Timeout (' + (timeoutMs / 1000) + 's)';
    else error = (err.cause?.code || err.code || err.message || String(err)).substring(0, 200);
  } finally { clearTimeout(timer); }
  if (totalTokens === 0 && fullText.length > 0) totalTokens = Math.round(fullText.length / 4);
  return buildRound(startTime, firstTokenTime, totalTokens, fullText.length, error);
}

// ============ Anthropic 协议流式 ============
async function testSingleRoundAnthropic(provider, model, prompt, timeoutMs) {
  const startTime = Date.now();
  let firstTokenTime = null, totalTokens = 0, fullText = '', error = null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const body = JSON.stringify({
      model, max_tokens: 4096, stream: true,
      messages: [{ role: 'user', content: prompt }]
    });
    const headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
    if (!provider.noAuth && provider.apiKey) headers['x-api-key'] = provider.apiKey;

    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(buildEndpoint(provider), { method: 'POST', headers, body, signal: ac.signal });
      if (res.status !== 429) break;
      if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      error = 'HTTP ' + res.status + (errBody ? ': ' + errBody.substring(0, 200) : '');
      clearTimeout(timer);
      return buildRound(startTime, null, 0, 0, error);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          if (json.type === 'error' && json.error) {
            error = 'API: ' + (json.error.message || json.error.type || JSON.stringify(json.error)).substring(0, 200);
            break;
          }
          if (json.type === 'content_block_delta' && json.delta) {
            if (firstTokenTime === null && json.delta.text) firstTokenTime = Date.now();
            if (json.delta.text) fullText += json.delta.text;
          }
          if (json.type === 'message_delta' && json.usage) totalTokens = json.usage.output_tokens || 0;
        } catch (e) {}
      }
      if (error) break;
    }
  } catch (err) {
    if (err.name === 'AbortError') error = 'Timeout (' + (timeoutMs / 1000) + 's)';
    else error = (err.cause?.code || err.code || err.message || String(err)).substring(0, 200);
  } finally { clearTimeout(timer); }
  if (totalTokens === 0 && fullText.length > 0) totalTokens = Math.round(fullText.length / 4);
  return buildRound(startTime, firstTokenTime, totalTokens, fullText.length, error);
}

// ============ Gemini 协议流式 ============
async function testSingleRoundGemini(provider, model, prompt, timeoutMs) {
  const startTime = Date.now();
  let firstTokenTime = null, totalTokens = 0, fullText = '', error = null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const base = (provider.baseUrl || '').replace(/\/+$/, '');
    const url = base + '/models/' + encodeURIComponent(model) + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(provider.apiKey || '');
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 4096 }
    });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ac.signal });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      error = 'HTTP ' + res.status + (errBody ? ': ' + errBody.substring(0, 200) : '');
      clearTimeout(timer);
      return buildRound(startTime, null, 0, 0, error);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          const parts = json.candidates?.[0]?.content?.parts;
          if (parts) {
            for (const p of parts) {
              if (p.text) {
                if (firstTokenTime === null) firstTokenTime = Date.now();
                fullText += p.text;
              }
            }
          }
          if (json.usageMetadata) totalTokens = json.usageMetadata.candidatesTokenCount || json.usageMetadata.totalTokenCount || 0;
        } catch (e) {}
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') error = 'Timeout (' + (timeoutMs / 1000) + 's)';
    else error = (err.cause?.code || err.code || err.message || String(err)).substring(0, 200);
  } finally { clearTimeout(timer); }
  if (totalTokens === 0 && fullText.length > 0) totalTokens = Math.round(fullText.length / 4);
  return buildRound(startTime, firstTokenTime, totalTokens, fullText.length, error);
}

function buildRound(startTime, firstTokenTime, totalTokens, textLen, error) {
  const endTime = Date.now();
  const totalTime = endTime - startTime;
  const ttfb = firstTokenTime ? firstTokenTime - startTime : null;
  return {
    success: !error, totalTime, ttfb, totalTokens, responseLength: textLen,
    tokensPerSec: totalTime > 0 ? parseFloat((totalTokens / (totalTime / 1000)).toFixed(1)) : 0,
    error
  };
}

async function testSingleRound(provider, model, prompt, timeoutMs) {
  if (provider.apiFormat === 'anthropic') return testSingleRoundAnthropic(provider, model, prompt, timeoutMs);
  if (provider.apiFormat === 'gemini') return testSingleRoundGemini(provider, model, prompt, timeoutMs);
  return testSingleRoundOpenAI(provider, model, prompt, timeoutMs);
}

async function testModel(provider, model, rounds, prompt, timeoutMs) {
  const results = [];
  for (let i = 0; i < rounds; i++) {
    results.push(await testSingleRound(provider, model, prompt, timeoutMs));
  }
  return results;
}

function summarize(model, results) {
  const ok = results.filter(r => r.success);
  const bad = results.filter(r => !r.success);
  const avg = (arr, f) => arr.length ? arr.reduce((s, r) => s + (r[f] || 0), 0) / arr.length : null;
  const min = (arr, f) => arr.length ? Math.min(...arr.map(r => r[f] || Infinity)) : null;
  const max = (arr, f) => arr.length ? Math.max(...arr.map(r => r[f] || 0)) : null;
  return {
    model, rounds: results.length, successCount: ok.length, failCount: bad.length,
    successRate: ((ok.length / results.length) * 100).toFixed(1),
    avgTotalTime: avg(ok, 'totalTime'), minTotalTime: min(ok, 'totalTime'), maxTotalTime: max(ok, 'totalTime'),
    avgTtfb: avg(ok, 'ttfb'), minTtfb: min(ok, 'ttfb'), maxTtfb: max(ok, 'ttfb'),
    avgTokens: avg(ok, 'totalTokens'),
    avgTokensPerSec: ok.length ? parseFloat((ok.reduce((s, r) => s + (r.tokensPerSec || 0), 0) / ok.length).toFixed(1)) : 0,
    errors: bad.map(r => ({ error: r.error }))
  };
}

// ============ API 路由 ============

// 列出 provider（脱敏：key 不返回明文，只返回 hasKey）
app.get('/api/providers', (req, res) => {
  const merged = getMergedProviders();
  const list = Object.values(merged).map(p => ({
    id: p.id, name: p.name, brand: p.brand, tags: p.tags || [],
    baseUrl: p.baseUrl,
    apiFormat: p.apiFormat, noAuth: p.noAuth, enabled: p.enabled,
    hasKey: !!p.apiKey, custom: !!p.custom, models: p.models
  }));
  res.json({ providers: list });
});

// 读取单个 provider 完整配置（含 key，用于编辑回填）
app.get('/api/providers/:id', (req, res) => {
  const merged = getMergedProviders();
  const p = merged[req.params.id];
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
});

// 保存单个 provider 用户配置
// body: { apiKey, baseUrl, apiFormat, enabled, extraModels, removedModelIds, name }
app.post('/api/providers/:id', (req, res) => {
  const id = req.params.id;
  const cfg = loadUserConfig();
  cfg.providers = cfg.providers || {};
  const cur = cfg.providers[id] || {};
  const b = req.body || {};
  const allowed = ['apiKey', 'baseUrl', 'apiFormat', 'enabled', 'extraModels', 'removedModelIds', 'name', 'noAuth'];
  for (const k of allowed) if (b[k] !== undefined) cur[k] = b[k];
  cfg.providers[id] = cur;
  saveUserConfig(cfg);
  res.json({ ok: true });
});

// 新增完全自定义 provider
app.post('/api/providers', (req, res) => {
  const b = req.body || {};
  if (!b.id || !b.name || !b.baseUrl) return res.status(400).json({ error: 'id/name/baseUrl required' });
  const cfg = loadUserConfig();
  cfg.providers = cfg.providers || {};
  cfg.providers[b.id] = {
    name: b.name, baseUrl: b.baseUrl,
    apiFormat: b.apiFormat || 'openai', apiKey: b.apiKey || '', enabled: !!b.enabled,
    noAuth: !!b.noAuth, extraModels: b.extraModels || []
  };
  saveUserConfig(cfg);
  res.json({ ok: true });
});

// 删除 provider 用户配置（自定义 provider 会被移除；默认 provider 会回到默认状态）
app.delete('/api/providers/:id', (req, res) => {
  const cfg = loadUserConfig();
  cfg.providers = cfg.providers || {};
  delete cfg.providers[req.params.id];
  saveUserConfig(cfg);
  res.json({ ok: true });
});

// 跑测试
app.post('/api/test', async (req, res) => {
  const {
    provider: providerId = 'qianfan', models, rounds = 3,
    prompt = 'Write a Python function that implements quicksort on a list. Output only the code, no explanation.',
    timeout = 30
  } = req.body;
  const merged = getMergedProviders();
  const providerCfg = merged[providerId];
  if (!providerCfg) return res.status(400).json({ error: 'provider not found' });
  if (!providerCfg.noAuth && !providerCfg.apiKey) return res.status(400).json({ error: 'API key not configured for ' + providerId });

  const modelList = models || providerCfg.models.map(m => m.id);
  const timeoutMs = timeout * 1000;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
    'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
  });
  const send = (data) => { if (!res.writableEnded) res.write('data: ' + JSON.stringify(data) + '\n\n'); };
  const hb = setInterval(() => send({ type: 'heartbeat' }), 4000);
  req.on('close', () => clearInterval(hb));

  const all = [];
  const t0 = Date.now();
  send({ type: 'start', total: modelList.length, models: modelList, rounds, timeout, provider: providerId });

  for (let i = 0; i < modelList.length; i++) {
    const m = modelList[i];
    if (res.writableEnded) break;
    send({ type: 'progress', model: m, index: i + 1, total: modelList.length });
    const rows = await testModel(providerCfg, m, rounds, prompt, timeoutMs);
    const s = summarize(m, rows);
    all.push(s);
    send({ type: 'result', model: m, summary: s, details: rows.map((r, j) => ({ ...r, round: j + 1 })) });
  }

  clearInterval(hb);
  send({ type: 'complete', total: modelList.length, totalTime: ((Date.now() - t0) / 1000).toFixed(1), results: all });
  res.end();
});

app.listen(PORT, () => {
  console.log('========================================');
  console.log('  Coding Plan 模型测试工具 v3');
  console.log('  地址: http://localhost:' + PORT);
  console.log('  默认配置: ' + DEFAULT_PATH);
  console.log('  用户配置: ' + USER_PATH);
  console.log('========================================');
  const merged = getMergedProviders();
  Object.values(merged).forEach(p => {
    const key = p.noAuth ? '[无需 KEY]' : (p.apiKey ? '[已配置 KEY]' : '[缺 KEY]');
    console.log('  - ' + p.name + ' (' + p.apiFormat + ') ' + key + ' models=' + p.models.length);
  });
  console.log('');
});
