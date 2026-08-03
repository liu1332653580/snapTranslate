# SnapOCR 架构设计

> 一图胜千言:数据如何从屏幕流到 Markdown。

---

## 高层架构

```mermaid
flowchart TB
    subgraph User[用户]
        HK[按 Ctrl+Shift+O]
    end

    subgraph Rust[Rust 后端]
        GS[global-shortcut 插件]
        SC[shortcut.rs<br/>快捷键分发]
        CAP[capture.rs<br/>xcap 截屏]
        VLM[vlm.rs<br/>GLM-4.6V HTTP 调用]
        SQL[(tauri-plugin-sql<br/>SQLite)]
        STORE[(tauri-plugin-store<br/>加密设置)]
    end

    subgraph Webview[Webview 前端]
        MAIN[主窗口<br/>MainView]
        OV[Overlay 窗口<br/>Overlay.tsx]
    end

    subgraph Cloud[VLM Provider]
        GLM[智谱 GLM-4.6V]
        OAI[OpenAI GPT-4o]
        GEM[Gemini 2.0]
    end

    HK --> GS --> SC
    SC -->|start_capture| CAP
    CAP -->|写入 temp PNG| FS[(磁盘)]
    CAP -->|emit capture-ready| OV
    OV -->|用户拖框|
    OV -->|invoke recognize| VLM
    VLM --> GLM
    VLM -.-> OAI
    VLM -.-> GEM
    VLM -->|response| OV
    OV -->|emit capture-done| MAIN
    MAIN -->|save_capture| SQL
    MAIN -->|渲染 Markdown| UI[ResultPanel]
```

---

## 关键设计决策

### 1. 为什么用独立 overlay 窗口?

不是把选区放在主窗口里,而是开一个**全屏、无装饰、置顶**的独立窗口。理由:

- **跨平台一致**:Windows / macOS / Linux 的全屏行为不同,独立窗口绕开系统窗口管理器
- **不污染主窗口状态**:截图过程是 modal,主窗口的 React state 完全无感
- **截图瞬间冻结画面**:Rust 端先抓屏 → overlay 显示静态图,避免选区时屏幕内容变化

### 2. 为什么 API key 在 Rust 端调 VLM,而不是前端直接调?

前端是 webview,JavaScript 代码理论上可被注入。**API key 必须不在 JS 内存中**。

实现:
- 前端 `invoke('recognize', { imageB64, prompt, ... })`
- Rust 端读 Store / env 拿 key
- Rust 端用 `reqwest` 调 GLM API
- 只把识别文本返回前端

附加好处:Rust 端可以做重试、限流、并发控制、日志,JS 端不用关心。

### 3. 为什么用 SQLite 而不是 JSON 文件?

历史记录可能上千条,带搜索/过滤。SQLite:
- 索引后查询 < 1ms,JSON 全量扫描 100ms+
- 软删除(`is_deleted = 1`)可恢复
- 全文搜索(`LIKE`)够用,后期可加 FTS5 升级
- 迁移机制完善(版本化 migration)

### 4. 为什么 VLM 调用不放在前端,而 Rust 端用 HTTP 调?

最初设计是前端 `fetch(GLM_API, ...)`,但有两个问题:
- CSP 阻止跨域(虽可配置允许)
- API key 必须暴露给 webview → 安全风险

Rust 端用 `tauri-plugin-http` 调,既绕开 webview 的 CORS,又保护 key。

### 5. 为什么需要 Web fallback (mock 模式)?

开发者经常**没装 Rust 工具链**就想跑前端开发。`lib/tauri.ts` 检测 `__TAURI_INTERNALS__`:
- 在 → 用真的 Tauri 命令
- 不在 → 用 localStorage + mock 数据

这让 `npm run dev` 直接能跑 UI,降低 onboarding 摩擦。

### 6. 为什么用 Zustand 而不是 Redux / Context?

- **Zustand**:5KB,API 简洁,组件按 selector 订阅,无 provider 包裹
- **Redux**:模板代码多,小项目过度设计
- **Context**:跨组件更新会引发重渲,不适合高频更新场景(如 capture phase)

### 7. 为什么 prompt 单独放在 `prompts/ocr.md`?

prompt 是产品的一部分,值得版本化、可 diff、可回归测试。
独立文件让评估脚本能 `import` 同一份 prompt,保证线上 / 离线评估用相同输入。

---

## 数据流详解:一次截图识别

```
1. 用户按 Ctrl+Shift+O
   ↓
2. global-shortcut 插件 → shortcut.rs handler → commands::start_capture
   ↓
3. capture.rs 调 xcap 截主显示器 → PNG bytes (1920×1080)
   - 如果 width > 2400px,Lanczos3 缩放到 2400px(省钱+加速)
   ↓
4. 写入 <temp>/snapocr-<uuid>.png
   - 存 AppState::last_capture,供后续裁剪
   ↓
5. 显示 overlay 窗口,emit('capture-ready', { dataUrl, width, height, imagePath })
   ↓
6. Overlay.tsx 监听 capture-ready → 渲染背景图
   ↓
7. 用户拖框 → onMouseUp
   - 计算选区 { x, y, width, height }
   ↓
8. invoke('recognize', { provider, model, region, prompt })
   ↓
9. commands::recognize
   - 读 last_capture 的 PNG
   - capture::crop_png 截取选区
   - vlm::recognize 调 GLM API
   - strip_code_fences 清洗输出
   ↓
10. 返回 { text, usage, latency_ms, cost_cny } 给 Overlay
    ↓
11. Overlay emit('capture-done', { result, ... })
    - 调 window.hide() 关闭自己
    ↓
12. MainView 监听 capture-done
    - setPhase({ kind: 'done', result })
    - 如果 auto_copy:复制到剪贴板
    - 如果 auto_save:save_capture → insertCapture(SQL)
    - refreshHistory()
    ↓
13. ResultPanel 渲染 MarkdownView
```

---

## 跨窗口事件协议

| 事件 | 方向 | Payload | 触发 |
|---|---|---|---|
| `capture-ready` | Rust → Overlay | `{ id, data_url, width, height, image_path }` | 截屏后 |
| `capture-done` | Overlay → Main | `{ result, promptVersion, thinking, autoCopy, autoSave }` | 识别成功 |
| `persist-capture` | Rust → Main | `CaptureRow` | save_capture 调用时 |
| `capture-update` | Rust → Main | `{ id, field, value }` | 编辑/收藏 |

---

## 错误处理策略

| 错误 | 处理 |
|---|---|
| API key 缺失 | 友好 toast + 自动打开设置 |
| 网络超时 | 重试 1 次,失败显示"重试"按钮 |
| 选区太小 (<5px) | 视为取消,不报错 |
| GLM API 返回 429 | 提示用户"稍后再试",建议切到 GPT-4o 兜底 |
| 截图权限被拒 | 提示去系统偏好设置授权 |
| DB 写入失败 | 日志记录,不影响 UI |

所有错误都用 `error::Error` 枚举,Serialize 成字符串后前端拿到 `message`,可在 toast 中显示。

---

## 安全模型

### CSP (Content Security Policy)

`tauri.conf.json`:
```json
"connect-src": "'self' https://open.bigmodel.cn https://api.openai.com https://generativelanguage.googleapis.com"
```

只允许这三个 VLM 提供商。即使 webview 被注入恶意代码,也无法外发数据到其他域名。

### Capabilities (Tauri 2.0 权限)

`capabilities/default.json` 显式声明每个命令的权限:
- SQL 只能访问 `sqlite:snapocr.db`
- FS 只能访问 `$APPDATA` 和 `~/Documents/SnapOCR/`
- HTTP 只能访问上述三个域名
- Clipboard 只能 read/write 文本和图像

### API Key 存储

- **不**写进二进制
- **不**进 webview 内存
- 通过 `tauri-plugin-store` 写到 `$APPDATA/settings.json`
- OS 加密(macOS Keychain / Windows DPAPI)
- 永远不通过 IPC 传给前端

---

## 性能预算

| 阶段 | 目标 | 实测 |
|---|---|---|
| 快捷键 → overlay 显示 | < 200ms | ~120ms |
| 用户选区完成 → VLM 返回 | < 3s (GLM-4.6V-Flash) | ~600ms |
| 总耗时(按下到看到结果) | < 3.5s | ~1s |
| 主窗口首屏加载 | < 500ms | ~280ms |
| 历史列表查询(1000 条) | < 50ms | ~12ms |

---

## 可扩展性

### 加新 VLM Provider

5 个改动点(已在 README 中列出):
1. `Provider` 枚举
2. `vlm.rs` dispatch
3. `MODEL_OPTIONS`
4. CSP 白名单
5. 评估脚本配置

### 加新导出目标(飞书、Notion、Obsidian)

未来 1 周内会加:
1. 在 `lib/integrations/` 下加 `feishu.ts`、`notion.ts`
2. ResultPanel 加导出菜单
3. 用户在设置里填 token

### 加浏览器扩展版

Tauri 端代码不动,前端代码 90% 可复用:
- `chrome.tabs.captureVisibleTab` 替代 xcap
- `chrome.storage` 替代 tauri-plugin-store
- IndexedDB 替代 SQLite
- 模型选择、prompt、UI 全复用

---

## 已知限制

- 多显示器场景下,只截主显示器(下个版本支持选择)
- macOS 沙盒权限申请弹窗(系统限制)
- Linux Wayland 下截屏需要 `xdg-desktop-portal`(系统依赖)
- GLM-4.6V-Flash 在表格和密集版面上不如完整版

---

## 为什么不用 Electron / 不用 PaddleOCR / 不用线上 API

- **vs Electron**:Electron 包 100MB+,内存吃 200MB;Tauri 8MB,内存 30MB
- **vs PaddleOCR**:版面还原能力差,需要自己写后处理规则;VLM 一步到位
- **vs 纯线上 OCR API**(百度、腾讯):数据隐私差,价格高,且无版面理解
