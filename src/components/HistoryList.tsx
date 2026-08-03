import { useEffect } from "react";
import { History, Search, Star } from "lucide-react";
import { Input } from "./ui/input";
import { useAppStore } from "@/lib/store";
import { formatCost, formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { getCapture } from "@/lib/db";
import { computeImageDataUrl } from "@/lib/tauri";
import type { CaptureRow } from "@/lib/types";

export function HistoryList() {
  const history = useAppStore((s) => s.history);
  const historyLoading = useAppStore((s) => s.historyLoading);
  const historyFilter = useAppStore((s) => s.historyFilter);
  const setHistoryFilter = useAppStore((s) => s.setHistoryFilter);
  const refreshHistory = useAppStore((s) => s.refreshHistory);
  const current = useAppStore((s) => s.current);
  const setCurrent = useAppStore((s) => s.setCurrent);
  const setPhase = useAppStore((s) => s.setPhase);
  const showToast = useAppStore((s) => s.showToast);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory, historyFilter.search, historyFilter.onlyStarred, historyFilter.model]);

  const handleSelect = async (id: string) => {
    try {
      const row = await getCapture(id);
      if (!row) return;
      setCurrent(row);
      let imageUrl: string | undefined;
      if (row.image_path) {
        imageUrl = await computeImageDataUrl(row.image_path).catch(() => undefined);
      }
      setPhase({
        kind: "done",
        dataUrl: imageUrl ?? "",
        result: {
          text: row.edited_text ?? row.raw_text,
          usage: {
            prompt_tokens: row.tokens_input ?? 0,
            completion_tokens: row.tokens_output ?? 0,
            total_tokens: (row.tokens_input ?? 0) + (row.tokens_output ?? 0),
          },
          model: row.model,
          latency_ms: row.latency_ms ?? 0,
          cost_cny: row.cost_cny ?? 0,
          provider: row.model.startsWith("gpt")
            ? "openai"
            : row.model.startsWith("gemini")
              ? "gemini"
              : "glm",
        },
      });
    } catch (e) {
      showToast(`加载失败: ${(e as Error).message}`, "error");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <History size={14} /> 历史
          <span className="text-xs text-muted-foreground">({history.length})</span>
        </div>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={historyFilter.search}
            onChange={(e) => setHistoryFilter({ search: e.target.value })}
            placeholder="搜索…"
            className="pl-7 h-8"
          />
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={historyFilter.onlyStarred}
            onChange={(e) => setHistoryFilter({ onlyStarred: e.target.checked })}
            className="accent-primary"
          />
          <Star size={12} /> 仅显示收藏
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        {historyLoading && history.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">加载中…</div>
        ) : history.length === 0 ? (
          <EmptyHistory />
        ) : (
          history.map((row) => (
            <HistoryItem
              key={row.id}
              row={row}
              active={current?.id === row.id}
              onSelect={() => handleSelect(row.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function HistoryItem({
  row,
  active,
  onSelect,
}: {
  row: CaptureRow;
  active: boolean;
  onSelect: () => void;
}) {
  const preview =
    (row.edited_text ?? row.raw_text).slice(0, 80).replace(/\n/g, " ") || "(空)";
  return (
    <button
      onClick={onSelect}
      className={cn(
        "block w-full border-b border-border/50 px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
        active && "bg-muted",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
            {row.model.replace("glm-4.6v", "GLM").replace("gpt-", "GPT-").replace("gemini-", "Gemini-")}
          </span>
          {row.is_starred && <Star size={11} className="fill-primary text-primary" />}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {formatRelativeTime(row.created_at)}
        </span>
      </div>
      <div className="mt-1 line-clamp-2 text-xs">{preview}</div>
      {(row.cost_cny || row.latency_ms) && (
        <div className="mt-1 text-[10px] text-muted-foreground/70">
          {row.latency_ms ? `${row.latency_ms}ms` : ""} {row.cost_cny ? `· ${formatCost(row.cost_cny)}` : ""}
        </div>
      )}
    </button>
  );
}

function EmptyHistory() {
  return (
    <div className="p-6 text-center text-xs text-muted-foreground">
      <History size={24} className="mx-auto mb-2 opacity-50" />
      <p>还没有历史记录</p>
      <p className="mt-1">按全局快捷键(Ctrl+Shift+O)开始第一次截图识别</p>
    </div>
  );
}
