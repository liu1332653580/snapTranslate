# SnapOCR 准确率评估方法

> 没有验证就上线,等于盲猜。这套方法保证我们的 99% 准确率承诺是可证伪、可回归、可对比的。

---

## 评估指标定义

| 指标 | 定义 | 目标 |
|---|---|---|
| **CER** (Character Error Rate) | 编辑距离 / 真值字数 | < 1% |
| **Accuracy** = 1 - CER | 字符级准确率 | > 99% |
| **Exact Match** | 整段完全正确 | > 80% |
| **Line Accuracy** | 行级完全匹配比例 | > 90% |
| **Median CER** | 排除异常样本的典型表现 | < 0.5% |

> **为什么不能只看字符级 99%**?
> 1000 字的文章 CER=1% 意味着有 10 个错字,可能散布在多处。
> 整段完全正确率(Exact Match)更能反映"用户能直接复制粘贴"的体验。

---

## 数据集规范

### 类别与配额

最少 100 张,目标 200+:

| 类别 | 数量 | 典型来源 |
|---|---|---|
| `chinese` 纯中文段落 | 30 | 微信公众号截图、新闻、文档 |
| `english` 纯英文段落 | 20 | Medium、GitHub README |
| `mixed` 中英混排 | 20 | 技术文档、产品说明 |
| `code` 代码 / 终端 | 20 | VS Code、终端、网页代码块 |
| `table` 表格 | 15 | Excel 截图、Notion 表格、网页表格 |
| `list` 列表 / 大纲 | 15 | 大纲、待办、菜单 |
| `emoji` 含 emoji/特殊符号 | 10 | 聊天记录、社交 |
| `low-res` 低分辨率 / 小字 | 10 | 远截图、缩略图 |

### 文件组织

```
datasets/
  screenshots/
    chinese/
      wechat-article-01.png
      news-tech-01.png
      ...
    english/
      ...
  ground-truth/
    chinese/
      wechat-article-01.txt   <-- 完全正确的 Markdown
      news-tech-01.txt
      ...
```

**关键**:`<id>.txt` 必须是"人眼核对后的 100% 正确版本",格式为 Markdown。任何 ground truth 错误都会污染整个评估。

### Ground Truth 编写约定

- **保留版面**:标题用 `#`、列表用 `-`、表格用 GFM 语法
- **代码块**:用三反引号包裹,标注语言
- **不要加工**:不要补字、不要纠错、不要美化
- **不确定处**:用 `[?]` 标记(算作错字但不污染其他字)
- **保存为 UTF-8**,无 BOM,LF 换行

---

## 评估流程

### 一次性准备

```bash
# 1. 安装依赖
npm install

# 2. 准备数据集(按上面结构放截图 + ground truth)

# 3. 生成索引
npm run eval:prepare
# 输出: datasets/index.json
```

### 单模型评估

```bash
export GLM_API_KEY=your-key-here
npm run eval -- --provider=GLM-4.6V-Flash --limit=20
```

输出会实时打印每张图的 CER:
```
→ chinese/wechat-01 [chinese]
  GLM-4.6V-Flash        CER=0.32%  acc=99.68%  210ms  ✓
→ english/medium-01 [english]
  GLM-4.6V-Flash        CER=0.85%  acc=99.15%  198ms
```

### 多模型对比

```bash
export GLM_API_KEY=...
export OPENAI_API_KEY=...      # 可选
export GEMINI_API_KEY=...      # 可选
npm run eval
```

会顺序跑所有配置的 provider,最后输出对比表。

### 深度思考模式评估

```bash
npm run eval -- --thinking
```

只对 GLM-4.6V 有效,会开启 `thinking: true`。

---

## 解读报告

`eval-results/report-<timestamp>.md` 示例:

```markdown
## Per-provider summary
| Provider | Mean CER | Accuracy | Exact Match | Mean Latency | Total Cost |
|---|---|---|---|---|---|
| GLM-4.6V-Flash | 0.42% | 99.58% | 82% | 218ms | ¥0.00 |
| GLM-4.6V | 0.31% | 99.69% | 88% | 412ms | ¥1.84 |
| GPT-4o | 0.55% | 99.45% | 78% | 480ms | ¥12.30 |

## Per-category CER
| Category | Provider | Mean CER |
|---|---|---|
| code | GLM-4.6V | 0.18% |
| code | GPT-4o | 0.12% |     <-- GPT-4o 在代码上更强
| table | GLM-4.6V | 0.45% |
| table | GLM-4.6V-Flash | 1.2% | <-- Flash 在表格上明显弱

## Outliers (highest CER)
| Sample | Provider | CER |
|---|---|---|
| low-res/screenshot-tiny | GLM-4.6V-Flash | 8.2% |  <-- 低分辨率是 Flash 弱项
| emoji/chat-with-emoji | GLM-4.6V | 3.1% |
```

### 决策方法

- **如果 GLM-4.6V 在所有类别都 > 99%**:主力用 GLM-4.6V-Flash,复杂场景(识别失败时)兜底到 GLM-4.6V
- **如果 Flash 在某些类别崩了**(如表格 CER > 2%):这些类别强制走 GLM-4.6V
- **如果代码场景 GPT-4o 明显更好**:在 ResultPanel 加个"用 GPT-4o 重试"按钮
- **看 Exact Match**:这是用户体验的硬指标,目标 > 80%

---

## 持续评估(产品上线后)

### 用户编辑即标注

ResultPanel 的"编辑后保存"功能:用户编辑后的文本 = 免费标注数据。

**实现**(已在代码中):
- 用户编辑 → `edited_text` 字段保存
- 每周脚本扫描:`edited_text != raw_text` 的样本进入"用户反馈"队列
- 抽样人工核对 → 加入下一轮评估集

### Prompt 变更回归

每次改 `prompts/ocr.md`:
1. bump 版本号(`snapocr-v1` → `snapocr-v2`)
2. 全量回归评估
3. 报告里对比 v1 vs v2 在每个类别上的 CER
4. 任一类别退化 > 0.2% 则不允许上线

### 监控线上表现

数据库 `captures` 表已记录:
- `model`、`thinking`、`latency_ms`、`tokens_*`、`cost_cny`
- `prompt_version`、`is_starred`、`edited_text`

每周 SQL 查询(可写成 `scripts/weekly-stats.sql`):
```sql
SELECT model,
       AVG(latency_ms) AS p50_latency,
       SUM(cost_cny) AS weekly_cost,
       SUM(CASE WHEN edited_text IS NOT NULL THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS edit_rate
FROM captures
WHERE created_at > datetime('now', '-7 days')
GROUP BY model;
```

`edit_rate` 高 = 用户改得多 = 识别不够准 = 需要 prompt 调优。

---

## 评估陷阱

避免这几个常见坑:

1. **测试集污染**——不要把训练样本当 ground truth(对 VLM 不直接相关,但若用同一份截图反复调 prompt 等于过拟合)
2. **cherry-picking**——别只测简单的中文段落,代码 / 表格 / 低分辨率才是真正考验
3. **忽略延迟**——99.9% 准确率但 5 秒延迟,产品体验照样崩
4. **忽略成本**——GPT-4o 在某些场景好 0.1%,但贵 20 倍,通常不值
5. **过早上线**——MVP 阶段 100 张样本是底线,正式版前目标 500+ 张

---

## 评估集扩展建议

冷启动阶段,可以借用公开数据集**采样**作为补充(只评估、不重新分发):

- **ICDAR 2013/2015/2019** — 经典 OCR benchmark
- **COCO-Text** — 自然场景英文
- **CASIA-HWDB** — 中文手写(不适合截图场景,可跳过)
- **OCRBench** — VLM OCR 评测,有公开图片
- **OmniDocBench** — 文档 OCR,涵盖 8 类

自己的截图样本**权重应该 > 70%**——这才是你真实用户的分布。
