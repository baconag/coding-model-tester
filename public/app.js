// ============ 状态 ============
var PROVIDERS = {};       // 来自后端，包含 hasKey/models/...
var currentProvider = '';
var MODELS = [];          // 当前 provider 的模型列表
var PROMPTS = {
  simple: 'Write a Python function that implements quicksort on a list. Output only the code, no explanation.',
  medium: 'Write a Python LRU cache class with get and put methods, O(1) time complexity. Output only the code, no explanation.',
  complex: 'Write a simple HTTP server in Python using only socket and json standard library. Support GET and POST, parse JSON request body, return JSON response. Output only full code, no explanation.'
};
var activeReader = null, testStartTime = 0, elapsedTimer = 0, allSummaries = {};

// ============ 工具 ============
function toast(msg, isErr) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 2200);
}
function fmtMs(ms) { if (ms == null) return '--'; if (ms < 1000) return Math.round(ms) + 'ms'; return (ms / 1000).toFixed(2) + 's'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

// ============ 徽章渲染 ============
function providerBadges(p) {
  var parts = [];
  if (p.tags && p.tags.indexOf('coding-plan') >= 0) parts.push('<span class="badge badge-coding">Coding Plan</span>');
  if (p.tags && p.tags.indexOf('aggregator') >= 0) parts.push('<span class="badge badge-aggr">聚合</span>');
  if (p.tags && p.tags.indexOf('local') >= 0) parts.push('<span class="badge badge-local">本地</span>');
  var fmt = (p.apiFormat || '').toLowerCase();
  if (fmt === 'openai') parts.push('<span class="badge badge-openai">OpenAI</span>');
  else if (fmt === 'anthropic') parts.push('<span class="badge badge-anthropic">Anthropic</span>');
  else if (fmt === 'gemini') parts.push('<span class="badge badge-gemini">Gemini</span>');
  return parts.join(' ');
}

function providerOptionText(p) {
  // <option> 不支持 HTML，用纯文本符号
  var brand = p.brand || p.name;
  var bits = [];
  if (p.tags && p.tags.indexOf('coding-plan') >= 0) bits.push('Coding Plan');
  if (p.apiFormat === 'openai') bits.push('OpenAI');
  else if (p.apiFormat === 'anthropic') bits.push('Anthropic');
  else if (p.apiFormat === 'gemini') bits.push('Gemini');
  var sub = bits.length ? '  ·  ' + bits.join(' / ') : '';
  var marker = p.noAuth ? '  · 本地' : (p.hasKey ? '' : '  ⚠');
  return brand + sub + marker;
}

// ============ 加载 providers ============
function loadProviders() {
  return fetch('/api/providers').then(function (r) { return r.json(); }).then(function (data) {
    PROVIDERS = {};
    var sel = document.getElementById('providerSelect');
    var prev = currentProvider;
    sel.innerHTML = '';
    data.providers.forEach(function (p) {
      PROVIDERS[p.id] = p;
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = providerOptionText(p);
      sel.appendChild(opt);
    });
    if (prev && PROVIDERS[prev]) sel.value = prev;
    else if (data.providers.length) sel.value = data.providers[0].id;
    currentProvider = sel.value;
    loadProviderModels();
  }).catch(function (e) { console.error(e); toast('加载 providers 失败: ' + e.message, true); });
}

function onProviderChange() {
  currentProvider = document.getElementById('providerSelect').value;
  loadProviderModels();
}

function loadProviderModels() {
  var p = PROVIDERS[currentProvider];
  if (!p) return;
  MODELS = (p.models || []).map(function (m) { return m.id; });
  var status = document.getElementById('providerKeyStatus');
  var badges = providerBadges(p);
  var keyTag;
  if (p.noAuth) keyTag = '<span class="provider-ok">无需 KEY</span>';
  else if (p.hasKey) keyTag = '<span class="provider-ok">KEY ✓</span>';
  else keyTag = '<span class="provider-warn">⚠ 未配置 KEY</span>';
  status.innerHTML = badges + ' &nbsp; ' + keyTag;
  if (MODELS.length === 0) {
    document.getElementById('checkRow').innerHTML = '<span style="color:var(--text-dim);font-size:12px">该服务商暂无模型，请在设置中添加。</span>';
  } else {
    document.getElementById('checkRow').innerHTML = MODELS.map(function (m) {
      return '<label><input type="checkbox" value="' + esc(m) + '" checked onchange="updateRows()"> <span class="model-name">' + esc(m) + '</span></label>';
    }).join('');
  }
  renderRows();
}

function getSelected() { return Array.from(document.querySelectorAll('#checkRow input:checked')).map(function (cb) { return cb.value; }); }
function selectAll() { document.querySelectorAll('#checkRow input').forEach(function (cb) { cb.checked = true; }); updateRows(); }
function deselectAll() { document.querySelectorAll('#checkRow input').forEach(function (cb) { cb.checked = false; }); updateRows(); }
function updateRows() { var s = getSelected(); document.querySelectorAll('#tableBody tr[data-model]').forEach(function (tr) { tr.style.display = s.indexOf(tr.dataset.model) >= 0 ? '' : 'none'; }); }
function renderRows() {
  document.getElementById('tableBody').innerHTML = MODELS.map(function (m) {
    return '<tr data-model="' + esc(m) + '"><td class="col-score" id="overall-' + esc(m) + '"><span class="val-dim">--</span></td><td class="col-model"><span class="model-name">' + esc(m) + '</span></td><td class="col-status"><span class="tag tag-wait">Wait</span></td><td class="col-round"><span class="val-dim">--</span></td><td class="col-time" id="time-' + esc(m) + '"><span class="val-dim">--</span></td><td class="col-ttfb" id="ttfb-' + esc(m) + '"><span class="val-dim">--</span></td><td class="col-rate" id="rate-' + esc(m) + '"><span class="val-dim">--</span></td><td class="col-tps" id="tps-' + esc(m) + '"><span class="val-dim">--</span></td><td class="col-minmax"><span class="val-dim">-- / --</span></td><td class="col-error"></td></tr>';
  }).join('') || '<tr><td colspan="10"><div class="empty-state">暂无模型</div></td></tr>';
  allSummaries = {};
  document.getElementById('scoreFooter').classList.add('hidden');
}
function resetRows() {
  document.querySelectorAll('#tableBody tr[data-model]').forEach(function (tr) {
    tr.querySelector('.col-status').innerHTML = '<span class="tag tag-wait">Wait</span>';
    tr.querySelector('.col-round').innerHTML = '<span class="val-dim">--</span>';
    tr.querySelector('.col-time').innerHTML = '<span class="val-dim">--</span>';
    tr.querySelector('.col-ttfb').innerHTML = '<span class="val-dim">--</span>';
    tr.querySelector('.col-rate').innerHTML = '<span class="val-dim">--</span>';
    tr.querySelector('.col-tps').innerHTML = '<span class="val-dim">--</span>';
    tr.querySelector('.col-minmax').innerHTML = '<span class="val-dim">-- / --</span>';
    tr.querySelector('.col-error').innerHTML = '';
    tr.querySelector('.col-score').innerHTML = '<span class="val-dim">--</span>';
  });
  updateRows();
  allSummaries = {};
  document.getElementById('scoreFooter').classList.add('hidden');
}
function setRowProgress(model) {
  var tr = document.querySelector('#tableBody tr[data-model="' + model + '"]'); if (!tr) return;
  var spin = '<span class="spinner"></span>';
  tr.querySelector('.col-status').innerHTML = '<span class="tag tag-run">Testing</span>';
  tr.querySelector('.col-round').innerHTML = spin;
  tr.querySelector('.col-time').innerHTML = spin;
  tr.querySelector('.col-ttfb').innerHTML = spin;
  tr.querySelector('.col-rate').innerHTML = spin;
  tr.querySelector('.col-tps').innerHTML = spin;
  tr.querySelector('.col-minmax').innerHTML = spin;
  tr.querySelector('.col-error').innerHTML = '';
}
function setRowResult(model, summary, details) {
  var tr = document.querySelector('#tableBody tr[data-model="' + model + '"]'); if (!tr) return;
  allSummaries[model] = summary;
  var rate = parseFloat(summary.successRate);
  var tagClass, tagText;
  if (rate === 100) { tagClass = 'tag tag-ok'; tagText = 'OK'; }
  else if (rate > 0) { tagClass = 'tag tag-partial'; tagText = 'Partial'; }
  else { tagClass = 'tag tag-fail'; tagText = 'FAIL'; }
  tr.querySelector('.col-status').innerHTML = '<span class="' + tagClass + '">' + tagText + '</span>';
  var pills = details.map(function (d) { if (d.success) return '<span class="round-pill ok" title="' + fmtMs(d.totalTime) + '">\u2713</span>'; return '<span class="round-pill fail" title="' + esc(d.error || 'fail') + '">\u2717</span>'; }).join('');
  tr.querySelector('.col-round').innerHTML = '<div class="round-pills">' + pills + '</div>';
  var avgTime = summary.avgTotalTime; var timeColor = 'val-dim';
  if (avgTime != null) { if (avgTime < 3000) timeColor = 'val-good'; else if (avgTime < 8000) timeColor = 'val-mid'; else timeColor = 'val-bad'; }
  tr.querySelector('.col-time').innerHTML = '<span class="' + timeColor + '">' + fmtMs(avgTime) + '</span>';
  tr.querySelector('.col-ttfb').innerHTML = fmtMs(summary.avgTtfb);
  tr.querySelector('.col-rate').innerHTML = '<span class="' + (rate >= 100 ? 'val-good' : rate > 0 ? 'val-mid' : 'val-bad') + '">' + summary.successRate + '%</span>';
  tr.querySelector('.col-tps').innerHTML = '<span class="' + (summary.avgTokensPerSec > 20 ? 'val-good' : summary.avgTokensPerSec > 5 ? 'val-mid' : 'val-dim') + '">' + summary.avgTokensPerSec + ' tok/s</span>';
  var minTime = summary.minTotalTime, maxTime = summary.maxTotalTime;
  if (minTime != null) tr.querySelector('.col-minmax').innerHTML = '<span class="val-good">' + fmtMs(minTime) + '</span><span class="val-dim"> / </span><span class="val-bad">' + fmtMs(maxTime) + '</span>';
  else tr.querySelector('.col-minmax').innerHTML = '<span class="val-dim">-- / --</span>';
  if (summary.errors && summary.errors.length > 0) tr.querySelector('.col-error').innerHTML = '<span class="error-cell">' + summary.errors.map(function (e) { return esc(e.error); }).join('<br>') + '</span>';
}

function rankBadge(n) { if (n === 1) return '<span class="rank-badge rank-1">1</span>'; if (n === 2) return '<span class="rank-badge rank-2">2</span>'; if (n === 3) return '<span class="rank-badge rank-3">3</span>'; return ''; }
function rankBadgeOnly(n) { if (n <= 3) return rankBadge(n); return '<span class="rank-num">' + n + '</span>'; }
function rank(arr, field, asc) { var s = arr.slice().sort(function (a, b) { var va = a[field] != null ? a[field] : asc ? Infinity : -Infinity; var vb = b[field] != null ? b[field] : asc ? Infinity : -Infinity; return asc ? va - vb : vb - va; }); var m = {}; s.forEach(function (item, i) { m[item.model] = i + 1; }); return m; }
function computeRankings() {
  var models = Object.keys(allSummaries); if (models.length < 2) return;
  var arr = models.map(function (m) { var s = allSummaries[m]; return { model: m, avgTime: s.avgTotalTime, ttfb: s.avgTtfb, tps: s.avgTokensPerSec, rate: parseFloat(s.successRate) }; });
  var ok = arr.filter(function (a) { return a.rate > 0; }); var fail = arr.filter(function (a) { return a.rate === 0; });
  if (ok.length < 1) return;
  var timeRank = rank(ok, 'avgTime', true), ttfbRank = rank(ok, 'ttfb', true), tpsRank = rank(ok, 'tps', false), rateRank = rank(ok, 'rate', false);
  arr.forEach(function (a) {
    if (a.rate === 0) return;
    var tr = document.querySelector('#tableBody tr[data-model="' + a.model + '"]'); if (!tr) return;
    var tCell = tr.querySelector('.col-time'); if (tCell && timeRank[a.model] <= 3) tCell.innerHTML += rankBadge(timeRank[a.model]);
    var tfCell = tr.querySelector('.col-ttfb'); if (tfCell && ttfbRank[a.model] <= 3) tfCell.innerHTML += rankBadge(ttfbRank[a.model]);
    var rCell = tr.querySelector('.col-rate'); if (rCell && rateRank[a.model] <= 3) rCell.innerHTML += rankBadge(rateRank[a.model]);
    var pCell = tr.querySelector('.col-tps'); if (pCell && tpsRank[a.model] <= 3) pCell.innerHTML += rankBadge(tpsRank[a.model]);
  });
  var minTime = Math.min.apply(null, ok.map(function (a) { return a.avgTime || Infinity; }));
  var maxTime = Math.max.apply(null, ok.map(function (a) { return a.avgTime || 0; }));
  var minTtfb = Math.min.apply(null, ok.map(function (a) { return a.ttfb || Infinity; }));
  var maxTtfb = Math.max.apply(null, ok.map(function (a) { return a.ttfb || 0; }));
  var minTps = Math.min.apply(null, ok.map(function (a) { return a.tps || 0; }));
  var maxTps = Math.max.apply(null, ok.map(function (a) { return a.tps || 0; }));
  var rng = function (v, lo, hi) { return hi - lo === 0 ? 50 : ((v - lo) / (hi - lo) * 100); };
  var scores = ok.map(function (a) { var speedScore = rng(maxTime - a.avgTime, 0, maxTime - minTime); var ttfbScore = rng(maxTtfb - a.ttfb, 0, maxTtfb - minTtfb); var tpsScore = rng(a.tps, minTps, maxTps); var total = a.rate * 0.25 + speedScore * 0.35 + ttfbScore * 0.20 + tpsScore * 0.20; return { model: a.model, rate: a.rate, speedScore: speedScore, ttfbScore: ttfbScore, tpsScore: tpsScore, total: total }; });
  if (ok.length === 1) { scores[0].total = scores[0].rate; scores[0].speedScore = scores[0].ttfbScore = scores[0].tpsScore = 50; }
  scores.sort(function (a, b) { return b.total - a.total; });
  scores.forEach(function (s, i) { var el = document.getElementById('overall-' + s.model); if (!el) return; el.innerHTML = rankBadgeOnly(i + 1) + ' <span style="font-size:10px;color:var(--text-dim)">' + s.total.toFixed(1) + '</span>'; });
  fail.forEach(function (f) { var el = document.getElementById('overall-' + f.model); if (!el) return; el.innerHTML = '<span style="color:var(--red);font-size:11px">--</span>'; });
  var footer = document.getElementById('scoreFooter'); footer.classList.remove('hidden');
  var detail = document.getElementById('scoreDetail');
  var html = '<table class="score-table"><thead><tr><th class="rank-col">Model</th><th>Success</th><th>Speed(35%)</th><th>TTFB(20%)</th><th>TPS(20%)</th><th>Total</th></tr></thead><tbody>';
  scores.forEach(function (s) { html += '<tr><td class="rank-col model-name">' + esc(s.model) + '</td><td>' + s.rate.toFixed(1) + '</td><td>' + s.speedScore.toFixed(1) + '</td><td>' + s.ttfbScore.toFixed(1) + '</td><td>' + s.tpsScore.toFixed(1) + '</td><td style="font-weight:700;color:' + (s.total >= scores[0].total ? 'var(--green)' : 'var(--text)') + '">' + s.total.toFixed(2) + '</td></tr>'; });
  html += '</tbody></table>';
  detail.innerHTML = html;
}

// ============ 跑测试 ============
async function startTest() {
  var selected = getSelected();
  if (selected.length === 0) { toast('请至少选一个模型', true); return; }
  var p = PROVIDERS[currentProvider];
  if (!p) { toast('请选择服务商', true); return; }
  if (!p.noAuth && !p.hasKey) { toast('该服务商未配置 API KEY，请点击右上角 ⚙ 配置', true); openSettings(currentProvider); return; }
  var rounds = parseInt(document.getElementById('rounds').value) || 3;
  var timeout = parseInt(document.getElementById('timeout').value) || 30;
  var promptKey = document.getElementById('promptPreset').value;
  var prompt = PROMPTS[promptKey];
  document.getElementById('btnStart').disabled = true;
  document.getElementById('btnStart').textContent = 'Running...';
  document.getElementById('btnStop').style.display = '';
  document.getElementById('providerSelect').disabled = true;
  var statusBar = document.getElementById('statusBar'); statusBar.classList.remove('hidden');
  document.getElementById('statusDot').className = 'status-dot running';
  document.getElementById('statusText').textContent = 'Connecting...';
  document.getElementById('statusText').style.color = '';
  document.getElementById('statusProgress').textContent = '';
  document.getElementById('statusElapsed').textContent = '';
  resetRows(); selected.forEach(function (m) { setRowProgress(m); });
  testStartTime = Date.now();
  elapsedTimer = setInterval(function () { var e = Math.floor((Date.now() - testStartTime) / 1000); document.getElementById('statusElapsed').textContent = e + 's'; }, 500);
  try {
    var response = await fetch('/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: currentProvider, models: selected, rounds: rounds, timeout: timeout, prompt: prompt }) });
    if (!response.ok) { var et = await response.text().catch(function () { return ''; }); throw new Error('HTTP ' + response.status + ': ' + et.substring(0, 200)); }
    document.getElementById('statusText').textContent = 'Testing (' + p.name + ')';
    var reader = response.body.getReader(); activeReader = reader;
    var decoder = new TextDecoder(); var buffer = ''; var completedCount = 0;
    while (true) {
      var result = await reader.read(); if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      var lines = buffer.split('\n'); buffer = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf('data: ') === 0) {
          try {
            var data = JSON.parse(line.slice(6));
            if (data.type === 'heartbeat') continue;
            if (data.type === 'progress') { document.getElementById('statusProgress').textContent = data.model + ' (' + data.index + '/' + data.total + ')'; }
            else if (data.type === 'result') { setRowResult(data.model, data.summary, data.details); completedCount++; document.getElementById('statusProgress').textContent = completedCount + '/' + selected.length; }
            else if (data.type === 'complete') { document.getElementById('statusDot').className = 'status-dot done'; document.getElementById('statusText').textContent = 'Done in ' + data.totalTime + 's'; document.getElementById('statusProgress').textContent = ''; computeRankings(); }
          } catch (e) { }
        }
      }
    }
  } catch (err) {
    document.getElementById('statusDot').className = 'status-dot idle';
    document.getElementById('statusText').textContent = 'Error: ' + err.message;
    document.getElementById('statusText').style.color = 'var(--red)';
  } finally {
    clearInterval(elapsedTimer); activeReader = null;
    document.getElementById('btnStart').disabled = false;
    document.getElementById('btnStart').textContent = 'Start';
    document.getElementById('btnStop').style.display = 'none';
    document.getElementById('providerSelect').disabled = false;
  }
}
function stopTest() {
  if (activeReader) { activeReader.cancel(); activeReader = null; }
  clearInterval(elapsedTimer);
  document.getElementById('statusDot').className = 'status-dot idle';
  document.getElementById('statusText').textContent = 'Stopped';
  document.getElementById('btnStart').disabled = false;
  document.getElementById('btnStart').textContent = 'Start';
  document.getElementById('btnStop').style.display = 'none';
  document.getElementById('providerSelect').disabled = false;
}

// ============ 设置弹窗 ============
function openSettings(focusId) {
  renderSettings(focusId);
  document.getElementById('settingsModal').classList.add('show');
}
function closeSettings() {
  document.getElementById('settingsModal').classList.remove('show');
  loadProviders(); // 刷新外部状态
}
function reloadProviders() { loadProviders().then(function(){ renderSettings(); toast('已重新加载'); }); }

function providerStatusTag(p) {
  if (p.noAuth) return '<span class="provider-ok">本地·无需 KEY</span>';
  if (p.hasKey) return '<span class="provider-ok">KEY 已配置</span>';
  return '<span class="provider-warn">⚠ 未配置 KEY</span>';
}

function renderSettings(focusId) {
  var body = document.getElementById('settingsBody');
  var providers = Object.values(PROVIDERS);
  var html = '<div class="provider-list" id="providerList">';
  providers.forEach(function (p) {
    var expanded = focusId && p.id === focusId;
    html += '<div class="provider-card' + (expanded ? ' expanded' : '') + '" data-pid="' + esc(p.id) + '">';
    html += '  <div class="provider-card-head" onclick="toggleCard(\'' + esc(p.id) + '\')">';
    html += '    <div class="title"><span class="arrow">▶</span><span class="brand-name">' + esc(p.brand || p.name) + '</span>' + providerBadges(p) + providerStatusTag(p) + '<span class="pid-hint">' + esc(p.id) + '</span></div>';
    html += '    <div style="font-size:11px;color:var(--text-dim)">' + (p.models ? p.models.length : 0) + ' models</div>';
    html += '  </div>';
    html += '  <div class="provider-card-body">' + renderProviderForm(p) + '</div>';
    html += '</div>';
  });
  html += '</div>';
  body.innerHTML = html;
}

function renderProviderForm(p) {
  var keyVal = ''; // 不回填安全起见，只在修改后使用
  var html = '<div class="form-grid">';
  html += '  <label>API Key' + (p.noAuth ? ' (可选)' : '') + '</label>';
  html += '  <input type="password" id="f-key-' + esc(p.id) + '" placeholder="' + (p.hasKey ? '(已保存，输入新值覆盖；留空不变)' : '填入 API Key') + '" autocomplete="new-password">';
  html += '  <label>Base URL</label>';
  html += '  <input type="text" id="f-url-' + esc(p.id) + '" value="' + esc(p.baseUrl) + '">';
  html += '  <label>Endpoint Path</label>';
  html += '  <input type="text" id="f-ep-' + esc(p.id) + '" value="' + esc(p.endpointPath || '') + '" placeholder="例如 /chat/completions 或 /v1/messages">';
  html += '  <label>API Format</label>';
  html += '  <select id="f-fmt-' + esc(p.id) + '"><option value="openai"' + (p.apiFormat === 'openai' ? ' selected' : '') + '>openai</option><option value="anthropic"' + (p.apiFormat === 'anthropic' ? ' selected' : '') + '>anthropic</option><option value="gemini"' + (p.apiFormat === 'gemini' ? ' selected' : '') + '>gemini</option></select>';
  html += '</div>';

  html += '<div class="section-title">模型列表</div>';
  html += '<div class="model-list" id="models-' + esc(p.id) + '">';
  if (p.models && p.models.length) {
    p.models.forEach(function (m) {
      var isExtra = m.extra;
      html += '<div class="model-row"><span class="' + (isExtra ? 'tag-extra' : 'tag-default') + '">' + (isExtra ? '自定义' : '内置') + '</span><span class="mid">' + esc(m.id) + '</span>';
      html += '<button class="icon-btn" title="移除" onclick="removeModel(\'' + esc(p.id) + '\', \'' + esc(m.id) + '\')">✖</button>';
      html += '</div>';
    });
  } else {
    html += '<div class="model-row" style="color:var(--text-dim)">(暂无模型)</div>';
  }
  html += '</div>';
  html += '<div class="add-model-row"><input type="text" id="add-mid-' + esc(p.id) + '" placeholder="模型 ID（例如 deepseek-v4-pro）"><button class="btn btn-accent" onclick="addModel(\'' + esc(p.id) + '\')">+ 添加模型</button></div>';

  html += '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">';
  if (p.hasKey || (p.models && p.models.some(function(m){return m.extra}))) {
    html += '  <button class="btn btn-danger" onclick="clearProvider(\'' + esc(p.id) + '\')">清除本地配置</button>';
  }
  html += '  <button class="btn btn-primary" onclick="saveProvider(\'' + esc(p.id) + '\')">💾 保存</button>';
  html += '</div>';
  html += '<div class="help">保存后可以在主页选择该服务商进行测试。</div>';
  return html;
}

function toggleCard(pid) {
  var card = document.querySelector('.provider-card[data-pid="' + pid + '"]');
  if (card) card.classList.toggle('expanded');
}
function addModel(pid) {
  var inp = document.getElementById('add-mid-' + pid);
  var mid = inp.value.trim(); if (!mid) return;
  var p = PROVIDERS[pid]; if (!p) return;
  if (p.models.some(function(m){return m.id===mid;})) { toast('模型已存在', true); return; }
  p.models.push({ id: mid, name: mid, extra: true });
  renderSettings(pid);
  toast('已添加，记得点“保存”');
}
function removeModel(pid, mid) {
  var p = PROVIDERS[pid]; if (!p) return;
  p.models = p.models.filter(function(m){return m.id!==mid;});
  if (!p._removed) p._removed = [];
  if (p._removed.indexOf(mid) < 0) p._removed.push(mid);
  renderSettings(pid);
  toast('已移除，记得点“保存”');
}
async function saveProvider(pid) {
  var p = PROVIDERS[pid]; if (!p) return;
  var keyVal = document.getElementById('f-key-' + pid).value;
  var body = {
    baseUrl: document.getElementById('f-url-' + pid).value.trim(),
    endpointPath: document.getElementById('f-ep-' + pid).value.trim(),
    apiFormat: document.getElementById('f-fmt-' + pid).value,
    enabled: true,
    extraModels: p.models.filter(function(m){return m.extra;}).map(function(m){return {id:m.id,name:m.name||m.id};}),
    removedModelIds: p._removed || []
  };
  if (keyVal) body.apiKey = keyVal;
  try {
    var r = await fetch('/api/providers/' + encodeURIComponent(pid), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    toast('已保存 ' + p.name);
    await loadProviders();
    renderSettings(pid);
  } catch (e) { toast('保存失败: ' + e.message, true); }
}
async function clearProvider(pid) {
  if (!confirm('清除该服务商的本地配置（API Key、自定义模型、修改过的 URL）？\n不会影响内置默认配置。')) return;
  try {
    var r = await fetch('/api/providers/' + encodeURIComponent(pid), { method: 'DELETE' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    toast('已清除');
    await loadProviders();
    renderSettings(pid);
  } catch (e) { toast('失败: ' + e.message, true); }
}

// ============ 启动 ============
// 点击遮罩关闭
window.addEventListener('click', function(e){ if (e.target.id === 'settingsModal') closeSettings(); });
loadProviders();
