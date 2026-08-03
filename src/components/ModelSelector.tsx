import { useState } from "react";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { MODEL_OPTIONS } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function ModelSelector() {
  const [open, setOpen] = useState(false);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const thinkingEnabled = useAppStore((s) => s.thinkingEnabled);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const toggleThinking = useAppStore((s) => s.toggleThinking);

  const selected = MODEL_OPTIONS.find((m) => m.id === selectedModelId) ?? MODEL_OPTIONS[0]!;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm hover:bg-muted/50 transition-colors"
      >
        <Sparkles size={14} className="text-primary" />
        <span className="font-medium">{selected.label}</span>
        <ChevronDown size={14} className="text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-30 w-80 rounded-md border border-border bg-card shadow-xl animate-fade-in">
          <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            选择模型
          </div>
          {MODEL_OPTIONS.map((m) => {
            const isActive = m.id === selectedModelId;
            return (
              <button
                key={m.id}
                onClick={() => {
                  setSelectedModel(m.id, m.provider);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors",
                  isActive && "bg-muted",
                )}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{m.label}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{m.hint}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {m.pricing}
                  </div>
                </div>
                {isActive && <Check size={16} className="mt-1 text-primary" />}
              </button>
            );
          })}
          <div className="border-t border-border p-2">
            <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/40 rounded">
              <input
                type="checkbox"
                checked={thinkingEnabled}
                onChange={toggleThinking}
                className="accent-primary"
              />
              <span>深度思考模式 (复杂版面更准)</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
