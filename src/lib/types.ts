/**
 * Shared domain types. These mirror the Rust structs in src-tauri/src/{vlm,commands}.rs.
 * Keep them in sync — the `Deserialize` impls on the Rust side are forgiving, but
 * mismatches will surface as runtime errors.
 */

export type Provider = "glm" | "openai" | "gemini";

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecognizeInput {
  provider: Provider;
  model?: string;
  /** Pre-encoded base64 PNG (no data: prefix). Mutually exclusive with `region`. */
  imageB64?: string;
  /** Region on the last full-screen capture. Mutually exclusive with `imageB64`. */
  region?: Region;
  prompt: string;
  thinking?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface RecognizeResponse {
  text: string;
  usage: Usage;
  model: string;
  latency_ms: number;
  cost_cny: number;
  provider: Provider;
}

export interface CaptureRow {
  id: string;
  created_at: string;
  image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  model: string;
  thinking: boolean;
  latency_ms: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_cny: number | null;
  raw_text: string;
  edited_text: string | null;
  prompt_version: string | null;
  source: string | null;
  tags: string | null;
  is_starred: boolean;
}

export interface SaveCaptureInput {
  imageB64?: string;
  imagePath?: string;
  imageWidth?: number;
  imageHeight?: number;
  model: string;
  thinking: boolean;
  latencyMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  costCny?: number;
  rawText: string;
  editedText?: string;
  promptVersion?: string;
  source?: string;
  tags?: string[];
  isStarred?: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
  provider: Provider;
  /** Pricing note shown in UI for transparency. */
  pricing: string;
  /** Recommended use case. */
  hint: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "glm-4.6v-flash",
    label: "GLM-4.6V-Flash (free)",
    provider: "glm",
    pricing: "¥0 / 免费",
    hint: "MVP 与日常截图,够快够准",
  },
  {
    id: "glm-4.6v",
    label: "GLM-4.6V",
    provider: "glm",
    pricing: "¥1/¥3 每 M tokens",
    hint: "复杂版面、表格、公式 — 当前 SOTA",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    pricing: "$2.5/$10 每 M tokens",
    hint: "海外兜底,代码与多语言稳健",
  },
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    provider: "gemini",
    pricing: "$0.1/$0.4 每 M tokens",
    hint: "评估对比用",
  },
];

export const DEFAULT_MODEL_ID = "glm-4.6v-flash";

export const DEFAULT_PROMPT = `You are SnapOCR, an OCR engine tuned for screenshots. Extract every piece of text from the image and return it as Markdown.

## Output rules

1. Output pure Markdown. Preserve the original layout: headings, lists, code blocks, tables, blockquotes.
2. Wrap code in fenced blocks with the correct language tag.
3. Render tables as GitHub-flavored Markdown tables.
4. Math: inline as $...$, display as $$...$$.
5. Diagrams without text: ignore. If a diagram has labels, capture only the labels as a bulleted list.
6. If a region is unreadable or you are unsure, write [?] instead of guessing.
7. Do NOT add commentary, summaries, or explanations. The output must be usable as-is.
8. Do NOT wrap the entire output in outer code fences.
9. If the image has no text, return an empty string.
10. Preserve original spelling, punctuation, and casing. Do not autocorrect.

Return only the Markdown.`;

export const PROMPT_VERSION = "snapocr-v1";
