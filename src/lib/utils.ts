import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner used by every UI component. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format milliseconds as a human-readable latency string. */
export function formatLatency(ms?: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Format CNY cost — small numbers show more precision. */
export function formatCost(cny?: number | null): string {
  if (cny == null) return "—";
  if (cny === 0) return "¥0";
  if (cny < 0.01) return `<¥0.01`;
  if (cny < 1) return `¥${cny.toFixed(3)}`;
  return `¥${cny.toFixed(2)}`;
}

/** ISO timestamp → "刚刚 / 5 分钟前 / 昨天 / 2026-08-03" */
export function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, (now - then) / 1000);

  if (diffSec < 30) return "刚刚";
  if (diffSec < 60) return `${Math.floor(diffSec)} 秒前`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 86400 * 2) return "昨天";
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

/** Token stats: "1.2k in · 0.8k out · 2.0k total" */
export function formatTokens(input?: number | null, output?: number | null): string {
  const fmt = (n?: number | null) =>
    n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  return `${fmt(input)} in · ${fmt(output)} out`;
}

/** Copy text to clipboard with Tauri plugin when available, execCommand fallback for web. */
export async function copyText(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  }
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

/** True when running inside a Tauri webview (vs. plain browser dev). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Debounce — useful for search inputs. */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Sleep helper for graceful loading transitions. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Sanitize a filename — strip path separators and reserved chars. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
}

/** Download a blob in browser context (web dev fallback). */
export function downloadBlob(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
