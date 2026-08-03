import { useEffect, useState } from "react";
import { Camera, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { ModelSelector } from "./ModelSelector";
import { SettingsDialog } from "./SettingsDialog";
import { useAppStore } from "@/lib/store";
import { captureFullScreen, recognize } from "@/lib/tauri";
import { getEffectivePrompt, getPromptVersion } from "@/lib/store";
import { insertCapture } from "@/lib/db";
import { saveCapture } from "@/lib/tauri";
import { isTauri, copyText } from "@/lib/utils";

export function Header() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useAppStore((s) => s.settings);
  const settingsLoaded = useAppStore((s) => s.settingsLoaded);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const selectedProvider = useAppStore((s) => s.selectedProvider);
  const thinkingEnabled = useAppStore((s) => s.thinkingEnabled);
  const setPhase = useAppStore((s) => s.setPhase);
  const setCurrent = useAppStore((s) => s.setCurrent);
  const refreshHistory = useAppStore((s) => s.refreshHistory);
  const showToast = useAppStore((s) => s.showToast);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Apply theme class to <html>.
  useEffect(() => {
    if (!settingsLoaded) return;
    const theme = settings.theme;
    const html = document.documentElement;
    const apply = (dark: boolean) => html.classList.toggle("light", !dark);
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches);
      const handler = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    apply(theme === "dark");
  }, [settings.theme, settingsLoaded]);

  // In Tauri, the global shortcut triggers the Rust side directly; this button
  // is a manual trigger for when the overlay window is closed or for web dev.
  const handleCaptureClick = async () => {
    if (!isTauri()) {
      // Web dev fallback — use mock recognize.
      showToast("Web 模式: 模拟一次识别", "info");
      try {
        setPhase({ kind: "recognizing", dataUrl: "" });
        const result = await recognize({
          provider: selectedProvider,
          model: selectedModelId,
          imageB64: "",
          prompt: getEffectivePrompt(settings),
          thinking: thinkingEnabled,
        });
        setPhase({ kind: "done", dataUrl: "", result });
        if (settings.auto_copy) await copyText(result.text);
        if (settings.auto_save) {
          const row = await saveCapture({
            model: result.model,
            thinking: thinkingEnabled,
            latencyMs: result.latency_ms,
            tokensInput: result.usage.prompt_tokens,
            tokensOutput: result.usage.completion_tokens,
            costCny: result.cost_cny,
            rawText: result.text,
            promptVersion: getPromptVersion(settings),
            source: "screenshot",
          });
          await insertCapture(row);
          setCurrent(row);
          refreshHistory();
        }
      } catch (e) {
        showToast(`失败: ${(e as Error).message}`, "error");
        setPhase({ kind: "idle" });
      }
      return;
    }

    // Tauri — kick off the Rust capture flow by emitting the global shortcut
    // equivalent. The cleanest path: ask user to press the hotkey. But we can
    // also trigger capture_full_screen and open an in-window overlay if needed.
    showToast("按 Ctrl+Shift+O (或你设置的快捷键) 截图", "info");
    await captureFullScreen().catch((e) =>
      showToast(`截图失败: ${(e as Error).message}`, "error"),
    );
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Sparkles size={14} />
        </div>
        <div>
          <div className="text-sm font-semibold">SnapOCR</div>
          <div className="text-[10px] text-muted-foreground">截图即结构化文字</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ModelSelector />
        <Button onClick={handleCaptureClick} size="default">
          <Camera size={16} /> 截图识别
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          aria-label="settings"
        >
          <SettingsIcon size={18} />
        </Button>
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
