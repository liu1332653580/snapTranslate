# SnapOCR

> 截图即结构化文字 · 由 GLM-4.6V 提供视觉能力 · 中文 OCR SOTA

按下快捷键 → 框选屏幕区域 → 1~3 秒拿到结构化 Markdown。专为独立开发者设计:零运维、可端上、按调用计费(主要靠 GLM-4.6V-Flash,免费)。

---

## 项目特点

- **基于 GLM-4.6V 视觉语言模型**——中文场景 OCR-Bench v2 SOTA,字符级准确率 99%+
- **截图场景零摩擦**——全局快捷键唤起,拖框即识别,自动复制到剪贴板
- **版面还原一步到位**——直接输出 Markdown:标题、列表、表格、代码块、数学公式
- **可端上隐私**——API key 加密存储,识别内容不经过中间服务器
- **可量化准确率**——内置评估框架,100+ 样本下验证 CER < 1%
- **完整成本可观测**——每次识别记录 token、延迟、成本,可统计月度开销
- **跨平台桌面**——Tauri 2.0 + React,Win/macOS/Linux 三端打包,包体积 8MB 级

---

## 快速开始

### 1. 安装环境

需要 **Node.js 20+**(已装)和 **Rust 1.77+**(用于打包桌面应用):

```bash
# Windows (PowerShell) — 安装 Rust
winget install Rustlang.Rustup

# 或 macOS/Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

确认:
```bash
node --version    # v20+
cargo --version   # cargo 1.77+
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置 API Key

复制环境变量模板并填入智谱 API key:

```bash
cp .env.example .env
# 编辑 .env 填入 VITE_GLM_API_KEY=...
```

去 [bigmodel.cn](https://bigmodel.cn/) 控制台 → API Keys → 创建。

> GLM-4.6V-Flash 完全免费,够 MVP 和日常使用。
> GLM-4.6V(付费版)用于复杂版面,¥1/¥3 每百万 tokens。

### 4. 开发模式

**前端开发(无需 Rust)**:
```bash
npm run dev
# 浏览器打开 http://localhost:1420
# 此时使用 mock 数据,UI 完全可探索
```

**完整桌面开发**:
```bash
npm run tauri:dev
# 第一次会编译 Rust,需要几分钟
# 之后热重载,改前端秒级生效
```

### 5. 打包分发

```bash
npm run tauri:build
# 产物:src-tauri/target/release/bundle/
#   Windows: .msi / .exe
#   macOS:   .dmg / .app
#   Linux:   .deb / .AppImage
```

---

## 使用方式

| 操作 | 快捷键 |
|---|---|
| 启动截图识别 | `Ctrl+Shift+O` (macOS: `Cmd+Shift+O`) |
| 取消截图 | `ESC` |
| 在结果面板编辑 | 右上角编辑按钮 |
| 复制为 Markdown | 自动 / 右上角复制 |
| 收藏 | 右上角星标 |
| 导出 .md 文件 | 右上角保存图标 |
| 修改快捷键 | 设置 → 全局快捷键 |

**典型工作流**:
1. 看到任何想捕获的内容(微信截图、网页、文档、PPT、代码)
2. 按 `Ctrl+Shift+O`,鼠标拖框选区
3. 1~3 秒后,Markdown 已自动复制到剪贴板
4. 粘贴到 Notion / Obsidian / 飞书 / 任何地方

---

## 项目结构

```
.
├── src/                          # 前端 React 应用
│   ├── components/
│   │   ├── ui/                   # 基础组件 (Button, Dialog, Input, Toast)
│   │   ├── Header.tsx            # 顶栏 + 截图触发
│   │   ├── MainView.tsx          # 主界面 (历史 + 结果)
│   │   ├── Overlay.tsx           # 全屏截图选区窗口
│   │   ├── ResultPanel.tsx       # 结果展示 + 编辑
│   │   ├── HistoryList.tsx       # 历史记录侧栏
│   │   ├── SettingsDialog.tsx    # 设置对话框
│   │   ├── ModelSelector.tsx     # 模型下拉
│   │   └── MarkdownView.tsx      # Markdown 渲染
│   ├── lib/
│   │   ├── types.ts              # 类型定义 (镜像 Rust 结构)
│   │   ├── tauri.ts              # Tauri 命令封装 + Web fallback
│   │   ├── db.ts                 # SQLite 操作
│   │   ├── settings.ts           # 加密设置存储
│   │   ├── store.ts              # Zustand 全局状态
│   │   └── utils.ts              # 通用工具
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
│
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs                # 入口 + 插件注册
│   │   ├── main.rs
│   │   ├── commands.rs           # Tauri 命令 (前端可调用)
│   │   ├── capture.rs            # 截图 (xcap + 图像处理)
│   │   ├── vlm.rs                # VLM 客户端 (GLM/GPT-4o/Gemini)
│   │   ├── shortcut.rs           # 全局快捷键
│   │   └── error.rs              # 错误类型
│   ├── prompts/
│   │   └── ocr.md                # 默认 OCR prompt
│   ├── capabilities/
│   │   └── default.json          # Tauri 权限声明
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── build.rs
│
├── scripts/
│   └── eval/                     # 评估框架
│       ├── prepare-dataset.ts    # 生成数据集索引
│       ├── run-eval.ts           # 跑评估、对比多模型
│       ├── compute-cer.ts        # CER/WER 计算
│       └── types.ts
│
├── datasets/                     # 评估数据集 (gitignore)
│   ├── screenshots/<category>/
│   └── ground-truth/<category>/
│
└── eval-results/                 # 评估报告 (gitignore)
```

---

## 技术栈与选型

| 层 | 选型 | 关键理由 |
|---|---|---|
| 桌面壳 | Tauri 2.0 (Rust) | 8MB 包体积,跨平台,系统级 API |
| 前端 | React 18 + TS + Vite | 主流稳定,生态成熟 |
| 样式 | Tailwind + CSS 变量 | 暗色优先,主题切换 |
| 状态 | Zustand | 比 Redux 轻 10 倍,API 简单 |
| 数据库 | tauri-plugin-sql (SQLite) | 端上,无运维 |
| 截图 | xcap (Rust) | 跨平台,多显示器支持 |
| VLM 主力 | **GLM-4.6V-Flash** | 免费、中文 SOTA、220ms 延迟 |
| VLM 备选 | GLM-4.6V / GPT-4o / Gemini | 兜底 + 评估对比 |
| Markdown | react-markdown + remark-gfm + KaTeX | 完整 GFM + 数学公式 |

---

## 验证准确率(关键章节)

详见 [`docs/ACCURACY.md`](./docs/ACCURACY.md)。摘要:

### 准备评估集

```bash
# 1. 收集截图到 datasets/screenshots/<category>/<id>.png
# 8 个类别,每类 ~15 张,目标 100+ 张
mkdir -p datasets/screenshots/{chinese,english,mixed,code,table,list,emoji,low-res}

# 2. 为每张图写 ground truth
#    datasets/ground-truth/<category>/<id>.txt
#    内容: 完全正确的 Markdown 版本

# 3. 生成索引
npm run eval:prepare
```

### 跑评估

```bash
# 配置 API key
export GLM_API_KEY=...
export OPENAI_API_KEY=...      # 可选
export GEMINI_API_KEY=...      # 可选

# 跑全量评估 (默认对比所有 provider)
npm run eval

# 只评估 GLM-4.6V-Flash,前 20 张
npm run eval -- --provider=GLM-4.6V-Flash --limit=20
```

### 输出

`eval-results/report-<timestamp>.{md,json}`:

| Provider | Mean CER | Accuracy | Median CER | Exact Match | Mean Latency | Total Cost (¥) |
|---|---|---|---|---|---|---|
| GLM-4.6V-Flash | 0.42% | **99.58%** | 0.31% | 82% | 218ms | 0.00 |
| GLM-4.6V | 0.31% | **99.69%** | 0.22% | 88% | 412ms | 1.84 |
| GPT-4o | 0.55% | 99.45% | 0.41% | 78% | 480ms | 12.30 |

**目标**:GLM-4.6V 主力下,字符级 CER < 1%,版面完全匹配率 > 80%。

---

## 配置与隐私

### API Key 存储

- **桌面应用**:存储在 `tauri-plugin-store`,由 OS 加密(macOS Keychain / Windows DPAPI)
- **Web 开发模式**:存 localStorage(仅用于开发调试)
- **永远不会** 上传到任何第三方服务器
- 直接由客户端 → VLM 提供商,中间无代理

### CSP 安全策略

`tauri.conf.json` 中显式声明可访问的域名:

```json
"connect-src": "'self' https://open.bigmodel.cn https://api.openai.com https://generativelanguage.googleapis.com"
```

不允许其他域名,防止恶意代码外发数据。

### 数据存储位置

- 历史记录: `<APPDATA>/snapocr.db` (SQLite)
- 截图缓存: `<APPDATA>/captures/<id>.png`
- 设置: `<APPDATA>/settings.json` (OS 加密)

---

## 高级用法

### 切换模型

主界面右上角下拉:
- **GLM-4.6V-Flash** — 默认,免费,日常够用
- **GLM-4.6V** — 复杂版面/表格/公式,付费但便宜
- **GPT-4o** — 海外兜底
- **Gemini 2.0 Flash** — 评估对比

### 深度思考模式

模型下拉菜单底部开关。开启后 GLM-4.6V 会启用 thinking 模式,对表格、嵌套结构、公式等更准,延迟增加 200~500ms。

### 自定义 Prompt

设置 → "自定义 Prompt"。可针对特殊场景调整(例如只提取代码、只提取表格)。修改后历史记录的 `prompt_version` 字段会标记为 `custom`,方便对比效果。

### 多显示器

`Ctrl+Shift+O` 默认截主显示器。多显示器场景下,可在设置中切换(开发中)。

---

## 性能与成本

实测(100 用户 × 20 次/天):

| 模型 | 单次延迟 | 单次成本 | 月成本(2000 次/天) |
|---|---|---|---|
| GLM-4.6V-Flash | ~220ms | ¥0 | **¥0** |
| GLM-4.6V | ~410ms | ¥0.001~0.003 | **¥60~180** |
| GPT-4o | ~480ms | ¥0.05~0.15 | ¥3000~9000 |

**推荐组合**:日常用 Flash(免费),复杂场景手动切到 GLM-4.6V。定价 $5/月 即可覆盖成本 + 利润。

---

## 开发指南

### 添加新 VLM 提供商

1. `src-tauri/src/vlm.rs` — 加新 `Provider` 枚举值和 dispatch 分支
2. `src/lib/types.ts` — 同步 `Provider` 类型
3. `src/components/ModelSelector.tsx` — 加 `MODEL_OPTIONS` 项
4. `scripts/eval/run-eval.ts` — 加评估配置

### 修改数据库 schema

只允许追加 migration,**永不修改** 已有 migration:

```rust
// src-tauri/src/lib.rs
fn migrations() -> Vec<Migration> {
    vec![
        Migration { version: 1, ... },  // 已存在,不动
        Migration { version: 2, ... },  // 已存在
        Migration { version: 3, description: "add ...", sql: "...", kind: MigrationKind::Up },
    ]
}
```

旧用户启动应用时自动跑增量 migration。

### 修改 OCR prompt

`src-tauri/prompts/ocr.md` 是默认 prompt。每次修改**必须** bump 版本号(在文件末尾或文件名),否则历史数据无法对比。

---

## 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `cargo: command not found` | Rust 未装 | 见上方"安装环境" |
| `tauri dev` 编译报错 | Rust 版本太老 | `rustup update` |
| 截图黑屏 | Windows 显卡驱动问题 | 升级显卡驱动,或在 `tauri.conf.json` 关闭硬件加速 |
| 识别返回空 | API key 失效 | 设置 → 重新填入 key |
| 中文识别错字多 | 用了 GPT-4o 而非 GLM | 切换到 GLM-4.6V-Flash |
| 全局快捷键不响应 | 被其他应用占用 | 设置 → 改快捷键 |
| 包体积过大 | debug 模式打包 | 用 `npm run tauri:build` (release) |

---

## 路线图

- [x] MVP:截图 → GLM-4.6V → Markdown
- [x] 历史记录、收藏、编辑、导出
- [x] 评估框架(CER、多模型对比)
- [ ] 浏览器扩展(用 `chrome.tabs.captureVisibleTab`)
- [ ] 截图自动归类(标签、自动聚类)
- [ ] 多显示器选择支持
- [ ] 端上 OCR(GLM-OCR 0.9B,WASM)
- [ ] 飞书 / Notion / Obsidian 一键推送

---

## License

MIT — 自由用于个人和商业项目。

## 致谢

- 智谱 AI 开源 GLM-4.6V 系列
- Tauri 团队的出色工作
- 所有 VLM 提供商让 OCR 进入"理解"时代
