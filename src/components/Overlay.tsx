import { useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { recognize } from "@/lib/tauri";
import { useAppStore, getEffectivePrompt, getPromptVersion } from "@/lib/store";
import type { Region } from "@/lib/types";
import { cn, sleep, isTauri } from "@/lib/utils";

interface CaptureReadyPayload {
  id: string;
  data_url: string;
  width: number;
  height: number;
  image_path: string;
}

interface DonePayload {
  result: Awaited<ReturnType<typeof recognize>>;
  promptVersion: string;
  thinking: boolean;
  autoCopy: boolean;
  autoSave: boolean;
}

/**
 * Full-screen transparent overlay for region selection.
 *
 * Lifecycle:
 *   1. Rust captures the screen, writes a temp PNG, emits `capture-ready`.
 *   2. This component receives the payload and renders the screenshot as background.
 *   3. User drags to select; on mouseup we send the region to Rust for cropping
 *      and call the VLM.
 *   4. On success we emit `capture-done` to the main window and close ourselves.
 */
export function Overlay() {
  const [payload, setPayload] = useState<CaptureReadyPayload | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const settings = useAppStore((s) => s.settings);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const selectedProvider = useAppStore((s) => s.selectedProvider);
  const thinkingEnabled = useAppStore((s) => s.thinkingEnabled);

  useEffect(() => {
    if (!isTauri()) return;
    const unlistenP = listen<CaptureReadyPayload>("capture-ready", (e) => {
      setPayload(e.payload);
    });
    return () => {
      unlistenP.then((fn) => fn());
    };
  }, []);

  const close = async () => {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    } catch {
      window.close();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !working) {
        void close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [working]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (working) return;
    setStart({ x: e.clientX, y: e.clientY });
    setEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!start) return;
    setEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseUp = async () => {
    if (!start || !end || working || !payload) {
      setStart(null);
      setEnd(null);
      return;
    }
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    setStart(null);
    setEnd(null);

    if (width < 5 || height < 5) {
      void close();
      return;
    }

    const region: Region = { x, y, width, height };
    setWorking(true);
    setError(null);

    try {
      const result = await recognize({
        provider: selectedProvider,
        model: selectedModelId,
        region,
        prompt: getEffectivePrompt(settings),
        thinking: thinkingEnabled,
      });

      const done: DonePayload = {
        result,
        promptVersion: getPromptVersion(settings),
        thinking: thinkingEnabled,
        autoCopy: settings.auto_copy,
        autoSave: settings.auto_save,
      };
      await emit("capture-done", done);
      await sleep(120);
      await close();
    } catch (e) {
      setError((e as Error).message);
      setWorking(false);
    }
  };

  const selRect =
    start && end
      ? {
          left: Math.min(start.x, end.x),
          top: Math.min(start.y, end.y),
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y),
        }
      : null;

  return (
    <div
      ref={overlayRef}
      className={cn(
        "fixed inset-0 cursor-crosshair select-none",
        working && "cursor-wait",
        !payload && "bg-black/40",
      )}
      style={
        payload
          ? {
              backgroundImage: `url(${payload.data_url})`,
              backgroundSize: `${payload.width}px ${payload.height}px`,
              backgroundPosition: "top left",
              backgroundRepeat: "no-repeat",
              backgroundColor: "rgba(0,0,0,0.25)",
            }
          : undefined
      }
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {selRect && (
        <div
          className="absolute border-2 border-primary bg-primary/10"
          style={{
            left: selRect.left,
            top: selRect.top,
            width: selRect.width,
            height: selRect.height,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        >
          <div className="absolute -top-6 left-0 whitespace-nowrap bg-primary px-1.5 py-0.5 text-[11px] font-mono text-primary-foreground rounded">
            {Math.round(selRect.width)} × {Math.round(selRect.height)}
          </div>
        </div>
      )}

      {working && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="rounded-lg border border-border bg-card px-6 py-4 text-center shadow-xl">
            <div className="text-sm font-medium">识别中…</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {selectedModelId} · {thinkingEnabled ? "深度思考" : "快速模式"}
            </div>
            {error && (
              <div className="mt-2 text-xs text-destructive">{error}</div>
            )}
          </div>
        </div>
      )}

      {!working && !selRect && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 rounded-md border border-border bg-black/70 px-4 py-2 text-xs text-white backdrop-blur">
          {payload ? "拖动选择区域 · ESC 取消" : "准备截图…"}
        </div>
      )}
    </div>
  );
}
