/**
 * Tauri invoke wrapper with web-dev fallback. When the app runs outside a
 * Tauri webview (`__TAURI_INTERNALS__` missing), every command returns a
 * mock so the UI is fully explorable with `npm run dev` before Rust is set up.
 */

import type {
  CaptureRow,
  RecognizeInput,
  RecognizeResponse,
  Region,
  SaveCaptureInput,
} from "./types";
import { isTauri, sleep } from "./utils";

type InvokeArgs = Record<string, unknown>;

async function invokeTauri<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------
//  Capture commands
// ---------------------------------------------------------------------------

export interface CaptureDto {
  data_url: string;
  png_b64: string;
  width: number;
  height: number;
}

export async function captureFullScreen(monitorIndex?: number): Promise<CaptureDto> {
  if (isTauri()) {
    return invokeTauri<CaptureDto>("capture_full_screen", {
      monitorIndex: monitorIndex ?? null,
    });
  }
  return mockCapture();
}

export async function captureRegion(region: Region): Promise<CaptureDto> {
  if (isTauri()) {
    return invokeTauri<CaptureDto>("capture_region", {
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    });
  }
  return mockCapture();
}

// ---------------------------------------------------------------------------
//  Recognition
// ---------------------------------------------------------------------------

export async function recognize(input: RecognizeInput): Promise<RecognizeResponse> {
  if (isTauri()) {
    return invokeTauri<RecognizeResponse>("recognize", {
      req: {
        provider: input.provider,
        model: input.model ?? null,
        image_b64: input.imageB64 ?? null,
        region: input.region ?? null,
        prompt: input.prompt,
        thinking: input.thinking ?? null,
        temperature: input.temperature ?? null,
        max_tokens: input.maxTokens ?? null,
      },
    });
  }
  return mockRecognize(input);
}

// ---------------------------------------------------------------------------
//  Persistence
// ---------------------------------------------------------------------------

export async function saveCapture(input: SaveCaptureInput): Promise<CaptureRow> {
  if (isTauri()) {
    return invokeTauri<CaptureRow>("save_capture", { input });
  }
  return mockSaveCapture(input);
}

export async function updateCaptureText(
  id: string,
  field: "edited_text" | "tags",
  value: string,
): Promise<void> {
  if (isTauri()) {
    await invokeTauri("update_capture_text", { id, field, value });
    return;
  }
  await mockUpdate(id, field, value);
}

export async function toggleStar(id: string, starred: boolean): Promise<void> {
  if (isTauri()) {
    await invokeTauri("toggle_star", { id, starred });
    return;
  }
  await mockUpdate(id, "is_starred", String(starred));
}

export async function deleteCapture(id: string, hard = false): Promise<void> {
  if (isTauri()) {
    await invokeTauri("delete_capture", { id, hard });
    return;
  }
  await mockDelete(id);
}

export async function computeImageDataUrl(imagePath: string): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("compute_image_data_url", { imagePath });
  }
  return "";
}

// ---------------------------------------------------------------------------
//  Shortcut
// ---------------------------------------------------------------------------

export async function setShortcut(accel: string): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("set_shortcut", { accel });
  }
  return accel;
}

export async function getActiveShortcut(): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("get_active_shortcut");
  }
  return "Ctrl+Shift+O";
}

export async function showMainWindow(): Promise<void> {
  if (isTauri()) {
    await invokeTauri("show_main_window");
  }
}

export async function hideApp(): Promise<void> {
  if (isTauri()) {
    await invokeTauri("hide_app");
  }
}

// ===========================================================================
//  Web-dev mocks — keep the UI testable without Rust. Persist to localStorage
//  so history is preserved across reloads.
// ===========================================================================

const LS_KEY = "snapocr-mock-history";

function readMockHistory(): CaptureRow[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as CaptureRow[]) : [];
  } catch {
    return [];
  }
}

function writeMockHistory(rows: CaptureRow[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(rows));
}

async function mockCapture(): Promise<CaptureDto> {
  await sleep(150);
  // 1x1 transparent PNG — the UI shows a placeholder instead.
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  return {
    data_url: `data:image/png;base64,${b64}`,
    png_b64: b64,
    width: 1,
    height: 1,
  };
}

async function mockRecognize(input: RecognizeInput): Promise<RecognizeResponse> {
  await sleep(800);
  const samples = [
    `# 示例识别结果

这是 **mock 模式**下的演示文本。前端在浏览器中独立运行,便于调试 UI。

- 列表项一
- 列表项二
- 列表项三

| 字段 | 值 |
|------|----|
| 模型 | ${input.model ?? "glm-4.6v-flash"} |
| 模式 | ${input.thinking ? "深度思考" : "快速"} |
| Provider | ${input.provider} |

\`\`\`ts
const demo = "代码块保留";
\`\`\``,
    `## Markdown 文档示例

> 这是一段引用文字,模拟从截图中提取出来的内容。

1. 第一步
2. 第二步
3. 第三步`,
  ];
  const text = samples[Math.floor(Math.random() * samples.length)] ?? samples[0]!;
  return {
    text,
    usage: {
      prompt_tokens: 850,
      completion_tokens: text.length,
      total_tokens: 850 + text.length,
    },
    model: input.model ?? "glm-4.6v-flash",
    latency_ms: 800,
    cost_cny: 0,
    provider: input.provider,
  };
}

async function mockSaveCapture(input: SaveCaptureInput): Promise<CaptureRow> {
  const row: CaptureRow = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    image_path: input.imagePath ?? null,
    image_width: input.imageWidth ?? null,
    image_height: input.imageHeight ?? null,
    model: input.model,
    thinking: input.thinking,
    latency_ms: input.latencyMs ?? null,
    tokens_input: input.tokensInput ?? null,
    tokens_output: input.tokensOutput ?? null,
    cost_cny: input.costCny ?? null,
    raw_text: input.rawText,
    edited_text: input.editedText ?? null,
    prompt_version: input.promptVersion ?? null,
    source: input.source ?? "screenshot",
    tags: input.tags ? JSON.stringify(input.tags) : null,
    is_starred: input.isStarred ?? false,
  };
  const rows = readMockHistory();
  rows.unshift(row);
  writeMockHistory(rows);
  return row;
}

async function mockUpdate(
  id: string,
  field: "edited_text" | "tags" | "is_starred",
  value: string,
) {
  const rows = readMockHistory();
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  if (field === "edited_text") row.edited_text = value;
  if (field === "tags") row.tags = value;
  if (field === "is_starred") row.is_starred = value === "true";
  writeMockHistory(rows);
}

async function mockDelete(id: string) {
  const rows = readMockHistory().filter((r) => r.id !== id);
  writeMockHistory(rows);
}
