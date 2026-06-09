# 🚀 Coding Model Tester

> **Multi-provider LLM coding benchmark tool** · Streaming · Real-time scoring · 17 providers built-in

English · [中文](./README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Status](https://img.shields.io/badge/Status-Active-success)]()

---

## ✨ Highlights

- 🌐 **17 built-in providers** — Qianfan / Volcengine Ark / DeepSeek / Moonshot / Qwen / Zhipu GLM / MiniMax / OpenAI / Anthropic / Gemini / OpenRouter / GitHub Copilot / Ollama / LM Studio ...
- 🔌 **Three API formats** — OpenAI / Anthropic / Gemini, auto-detected per provider
- 📊 **Complete metrics** — Total time, TTFB (time-to-first-byte), throughput (tok/s), success rate, error details
- 🏆 **Smart composite scoring** — SuccessRate(25%) + Speed(35%) + TTFB(20%) + Throughput(20%), with rankings
- 🎨 **Zero-build frontend** — Vanilla HTML/JS + modern dark theme, no toolchain required
- ⚙️ **Web-based config** — Set API Keys, change URLs, add custom models via UI
- 🔒 **Local-only secrets** — API Keys stored in local `user-config.json`, gitignored
- 🏠 **Local models supported** — Ollama, LM Studio work out of the box

---

## 📸 Screenshots

**Main panel · Provider selection**

![Provider selection](./docs/screenshots/01-provider-list.png)

**Main panel · Benchmark dashboard (with rank badges)**

![Dashboard](./docs/screenshots/04-dashboard.png)

**Main panel · Composite scoring table**

![Scoring](./docs/screenshots/05-scoring.png)

**Settings modal · Provider configuration**

![Provider config](./docs/screenshots/02-provider-config.png)

**Settings modal · Key & model management**

![Keys and models](./docs/screenshots/03-key-and-models.png)

---

## 🚀 Quick Start

### 1. Clone & install

```bash
git clone https://github.com/baconag/coding-model-tester.git
cd coding-model-tester
npm install
```

### 2. Run

```bash
npm start
# Or on Windows: double-click start.bat
```

Server listens on [http://localhost:3458](http://localhost:3458).

### 3. Configure API keys

Open the browser → click **⚙ Configure providers / KEY** in the top right → select a provider → paste your key → **💾 Save**.

Configuration is persisted to `user-config.json` (auto-created, gitignored).

### 4. Run a benchmark

Pick a provider from the dropdown → tick the models to compare → **Start**.

---

## 📋 Built-in Providers

| Provider | Format | Default URL | Notes |
|----------|--------|-------------|-------|
| Baidu Qianfan (Coding Plan) | openai | `qianfan.baidubce.com/v2/coding` | Baidu coding-exclusive plan |
| Volcengine Ark (Coding Plan) | anthropic | `ark.cn-beijing.volces.com/api/coding` | ByteDance Doubao coding plan |
| DeepSeek | anthropic | `api.deepseek.com/anthropic` | |
| Moonshot Kimi | openai | `api.moonshot.cn/v1` | |
| Alibaba Qwen | anthropic | `dashscope.aliyuncs.com/apps/anthropic` | |
| Zhipu GLM | anthropic | `open.bigmodel.cn/api/anthropic` | |
| MiniMax | anthropic | `api.minimaxi.com/anthropic` | |
| StepFun | openai | `api.stepfun.com/v1` | |
| Xiaomi MiMo | anthropic | `api.xiaomimimo.com/anthropic` | |
| Youdao | openai | `openapi.youdao.com/llmgateway/api/v1` | |
| OpenAI | openai | `api.openai.com/v1` | |
| Anthropic | anthropic | `api.anthropic.com` | |
| Google Gemini | gemini | `generativelanguage.googleapis.com/v1beta` | |
| OpenRouter | openai | `openrouter.ai/api/v1` | Aggregator |
| GitHub Copilot | openai | `api.individual.githubcopilot.com` | |
| Ollama | openai | `localhost:11434/v1` | Local, no key |
| LM Studio | openai | `localhost:1234/v1` | Local, no key |

> Want more? Just edit [providers-default.json](./providers-default.json) — no code changes.

---

## 🎯 Test Scenarios

Three preset prompts:

| Difficulty | Task |
|------------|------|
| **Easy** | Implement quicksort |
| **Medium** | Implement an O(1) LRU cache |
| **Hard** | Build an HTTP server (GET/POST + JSON) with stdlib only |

Edit `PROMPTS` in `public/app.js` to add your own.

---

## 📊 Scoring Formula

```
Score = SuccessRate × 0.25
      + SpeedScore  × 0.35   (based on avg total time, min-max normalized)
      + TTFBScore   × 0.20   (time to first byte, lower is better)
      + TPSScore    × 0.20   (throughput tok/s, higher is better)
```

Top 3 models get 🥇🥈🥉 badges in the result table.

---

## 🔧 Adding a New Provider

**Option A: Edit defaults** (recommended, shared by all users)

Add an entry to [providers-default.json](./providers-default.json):

```json
"myprovider": {
  "name": "My Provider",
  "baseUrl": "https://api.example.com/v1",
  "apiFormat": "openai",
  "endpointPath": "/chat/completions",
  "models": [
    { "id": "model-a", "name": "Model A" }
  ]
}
```

**Option B: Local-only custom models**

In any provider card in the settings modal → type model ID → **+ Add Model** → 💾 Save.

---

## 🗂️ Project Layout

```
coding-model-tester/
├── server.js                   # Express backend + 3 protocol adapters
├── providers-default.json      # Default providers/URLs/models (editable)
├── user-config.example.json    # Template for user config
├── user-config.json            # Local user config (auto-generated, gitignored)
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js                  # Frontend logic + settings modal
├── package.json
├── start.bat                   # Windows one-click launcher
├── .gitignore
├── README.md                   # 中文文档
├── README_EN.md                # This file
└── LICENSE
```

---

## 🔐 Security Notes

- ✅ `user-config.json` is **gitignored** — never committed
- ✅ The `/api/providers` GET endpoint is **redacted**: frontend only sees `hasKey: true/false`
- ✅ **No hardcoded keys** anywhere in source
- ⚠️ `user-config.json` stores keys in **plain text** — local machine use only
- ⚠️ Server binds to **localhost only** — do not expose to the public internet

---

## 🤝 Contributing

PRs welcome! Especially:

- New provider defaults
- Fixes for changed model IDs / URLs
- UI polish / charts
- Internationalization (i18n)

---

## 📄 License

[MIT](./LICENSE) © 2026 baconag

---

## 🙋 FAQ

**Q: Why does a provider show "⚠️ Missing KEY"?**
A: Built-in entries only ship default URLs and model lists. You need to obtain a key from each provider yourself.

**Q: Are results persisted?**
A: Not in the current version — refresh resets everything. Easy to extend if needed (write summary to local JSON).

**Q: What is Qianfan Coding Plan?**
A: Baidu's dedicated low-latency endpoint for coding scenarios. Different from their generic chat API.

**Q: Can it test image inputs?**
A: Currently text-only coding tasks. Use a separate script for vision testing.

---

If this project helps you, please ⭐ the repo!
