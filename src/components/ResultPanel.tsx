import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Edit3,
  FileText,
  Loader2,
  Save,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";
import { MarkdownView } from "./MarkdownView";
import {
  copyText,
  downloadBlob,
  formatCost,
  formatLatency,
  formatRelativeTime,
  formatTokens,
  sanitizeFilename,
} from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import type { CaptureRow, RecognizeResponse } from "@/lib/types";
import {
  deleteCapture,
  saveCapture,
  toggleStar,
  updateCaptureText,
} from "@/lib/tauri";
import { insertCapture, softDeleteCapture, updateRow } from "@/lib/db";

interface ResultPanelProps {
  /** When set, we render a saved history row; otherwise the live `phase.result`. */
  row?: CaptureRow | null;
  live?: RecognizeResponse | null;
  imageUrl?: string;
  onCleared?: () => void;
}

export function ResultPanel({ row, live, imageUrl, onCleared }: ResultPanelProps) {
  const showToast = useAppStore((s) => s.showToast);
  const refreshHistory = useAppStore((s) => s.refreshHistory);
  const settings = useAppStore((s) => s.settings);
  const setCurrent = useAppStore((s) => s.setCurrent);
  const current = useAppStore((s) => s.current);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const text = row?.edited_text ?? row?.raw_text ?? live?.text ?? "";
  const displayText = row?.edited_text ?? row?.raw_text ?? live?.text ?? "";
  const isSaved = !!row;

  useEffect(() => {
    setEditing(false);
    setDraft("");
  }, [row?.id, live]);

  const handleCopy = async () => {
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    if (!isSaved && live && settings.auto_copy) {
      // already copied — no toast
    }
  };

  const handleSaveEdit = async () => {
    if (!row) return;
    await updateCaptureText(row.id, "edited_text", draft);
    await updateRow(row.id, "edited_text", draft);
    setEditing(false);
    if (current?.id === row.id) {
      setCurrent({ ...row, edited_text: draft });
    }
    showToast("已保存编辑", "success");
    refreshHistory();
  };

  const handleStar = async () => {
    if (!row) return;
    const next = !row.is_starred;
    await toggleStar(row.id, next);
    await updateRow(row.id, "is_starred", String(next));
    refreshHistory();
  };

  const handleDelete = async () => {
    if (!row) return;
    if (!confirm("确定删除这条记录吗?")) return;
    await deleteCapture(row.id);
    await softDeleteCapture(row.id);
    showToast("已删除", "success");
    setCurrent(null);
    refreshHistory();
    onCleared?.();
  };

  const handleSaveToHistory = async () => {
    if (!live) return;
    const newRow = await saveCapture({
      model: live.model,
      thinking: settings.thinking_by_default,
      latencyMs: live.latency_ms,
      tokensInput: live.usage.prompt_tokens,
      tokensOutput: live.usage.completion_tokens,
      costCny: live.cost_cny,
      rawText: live.text,
      promptVersion: settings.prompt_override ? "custom" : "snapocr-v1",
      source: "screenshot",
    });
    await insertCapture(newRow);
    setCurrent(newRow);
    refreshHistory();
    showToast("已保存到历史", "success");
  };

  const handleExportMarkdown = () => {
    const filename = `${sanitizeFilename(text.slice(0, 30) || "snapocr")}-${Date.now()}.md`;
    downloadBlob(filename, "text/markdown;charset=utf-8", text);
    showToast(`已导出 ${filename}`, "success");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <FileText size={16} className="text-muted-foreground" />
          <div className="text-sm">
            <div className="font-medium">
              {row?.model ?? live?.model ?? "—"}
              {row?.thinking || live ? "" : ""}
            </div>
            <div className="text-xs text-muted-foreground">
              {row ? (
                <>
                  {formatRelativeTime(row.created_at)}
                  {row.latency_ms && <> · {formatLatency(row.latency_ms)}</>}
                  {row.cost_cny != null && <> · {formatCost(row.cost_cny)}</>}
                  {" · "}
                  {formatTokens(row.tokens_input, row.tokens_output)}
                </>
              ) : live ? (
                <>
                  {formatLatency(live.latency_ms)} · {formatCost(live.cost_cny)} ·{" "}
                  {formatTokens(live.usage.prompt_tokens, live.usage.completion_tokens)}
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isSaved && (
            <Button variant="ghost" size="icon" onClick={handleStar} aria-label="star">
              <Star
                size={16}
                className={row!.is_starred ? "fill-primary text-primary" : ""}
              />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            disabled={!text}
            aria-label="copy"
          >
            {copied ? <Check size={16} className="text-primary" /> : <Copy size={16} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleExportMarkdown}
            disabled={!text}
            aria-label="export"
            title="导出 Markdown"
          >
            <Save size={16} />
          </Button>
          {isSaved && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setDraft(text);
                  setEditing((v) => !v);
                }}
                aria-label="edit"
              >
                <Edit3 size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDelete}
                aria-label="delete"
              >
                <Trash2 size={16} className="text-destructive" />
              </Button>
            </>
          )}
          {!isSaved && live && (
            <Button size="sm" onClick={handleSaveToHistory}>
              保存到历史
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4">
        {editing ? (
          <div className="flex h-full flex-col gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 min-h-[400px]"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                取消
              </Button>
              <Button size="sm" onClick={handleSaveEdit}>
                保存
              </Button>
            </div>
          </div>
        ) : (
          <MarkdownView content={displayText} />
        )}
      </div>

      {/* Footer thumbnail */}
      {imageUrl && (
        <div className="border-t border-border p-2">
          <img
            src={imageUrl}
            alt="capture"
            className="max-h-24 w-auto rounded border border-border"
          />
        </div>
      )}
    </div>
  );
}

/** Loading state shown while a recognition request is in flight. */
export function ResultPanelLoading() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 size={28} className="animate-spin text-primary" />
      <div className="text-sm">正在识别中…</div>
      <div className="text-xs text-muted-foreground/70">
        GLM-4.6V 通常在 1~3 秒返回结果
      </div>
    </div>
  );
}
