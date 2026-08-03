import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Camera, Sparkles } from "lucide-react";
import { Header } from "./Header";
import { HistoryList } from "./HistoryList";
import { ResultPanel, ResultPanelLoading } from "./ResultPanel";
import { useAppStore } from "@/lib/store";
import { insertCapture } from "@/lib/db";
import { saveCapture } from "@/lib/tauri";
import { isTauri, copyText } from "@/lib/utils";
import type { RecognizeResponse } from "@/lib/types";

interface CaptureDonePayload {
  result: RecognizeResponse;
  promptVersion: string;
  thinking: boolean;
  autoCopy: boolean;
  autoSave: boolean;
}

export function MainView() {
  const phase = useAppStore((s) => s.phase);
  const setPhase = useAppStore((s) => s.setPhase);
  const current = useAppStore((s) => s.current);
  const setCurrent = useAppStore((s) => s.setCurrent);
  const refreshHistory = useAppStore((s) => s.refreshHistory);
  const showToast = useAppStore((s) => s.showToast);

  // Cross-window event listener — overlay window emits when recognition completes.
  useEffect(() => {
    if (!isTauri()) return;
    const unlistenP = listen<CaptureDonePayload>("capture-done", async (e) => {
      const { result, promptVersion, thinking, autoCopy, autoSave } = e.payload;
      setPhase({ kind: "done", dataUrl: "", result });

      if (autoCopy) {
        await copyText(result.text).catch(() => undefined);
      }

      if (autoSave) {
        try {
          const row = await saveCapture({
            model: result.model,
            thinking,
            latencyMs: result.latency_ms,
            tokensInput: result.usage.prompt_tokens,
            tokensOutput: result.usage.completion_tokens,
            costCny: result.cost_cny,
            rawText: result.text,
            promptVersion,
            source: "screenshot",
          });
          await insertCapture(row);
          setCurrent(row);
          refreshHistory();
        } catch (err) {
          showToast(`保存失败: ${(err as Error).message}`, "error");
        }
      }
    });
    return () => {
      unlistenP.then((fn) => fn());
    };
  }, [setPhase, setCurrent, refreshHistory, showToast]);

  return (
    <div className="flex h-screen flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 shrink-0 border-r border-border bg-card/30">
          <HistoryList />
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-hidden bg-background">
          {phase.kind === "recognizing" ? (
            <ResultPanelLoading />
          ) : phase.kind === "done" || current ? (
            <ResultPanel
              row={current}
              live={phase.kind === "done" ? phase.result : null}
              imageUrl={phase.kind === "done" ? phase.dataUrl : undefined}
            />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <Camera size={28} className="text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-lg font-semibold">开始第一次截图识别</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        按 <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">Ctrl+Shift+O</kbd>
        ,或点击右上角"截图识别"按钮,框选屏幕区域即可。
      </p>
      <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles size={12} className="text-primary" />
        <span>由 GLM-4.6V 提供 OCR 能力 · 中文 SOTA · 截图场景 99%+ 字符准确率</span>
      </div>
    </div>
  );
}
