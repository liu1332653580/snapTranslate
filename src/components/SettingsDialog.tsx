import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Keyboard } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input, Textarea } from "./ui/input";
import { useAppStore } from "@/lib/store";
import { DEFAULT_PROMPT } from "@/lib/types";
import { getActiveShortcut, setShortcut as persistShortcut } from "@/lib/tauri";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const showToast = useAppStore((s) => s.showToast);

  const [showGlm, setShowGlm] = useState(false);
  const [showOpenai, setShowOpenai] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [shortcut, setShortcut] = useState("");
  const [shortcutOriginal, setShortcutOriginal] = useState("");

  useEffect(() => {
    if (!open) return;
    getActiveShortcut().then((s) => {
      setShortcut(s);
      setShortcutOriginal(s);
    });
  }, [open]);

  const handleSaveShortcut = async () => {
    if (shortcut === shortcutOriginal) return;
    try {
      await persistShortcut(shortcut);
      setShortcutOriginal(shortcut);
      showToast("快捷键已更新", "success");
    } catch (e) {
      showToast(`快捷键无效: ${(e as Error).message}`, "error");
      setShortcut(shortcutOriginal);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="设置"
      description="API key 存储在系统加密存储中,不会同步到云端。"
      className="max-w-2xl"
      footer={
        <Button onClick={onClose}>完成</Button>
      }
    >
      <div className="space-y-6">
        {/* API keys */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <KeyRound size={14} /> API Keys
          </h3>
          <div className="space-y-3">
            <KeyField
              label="智谱 GLM"
              hint="前往 bigmodel.cn 申请"
              value={settings.glm_api_key}
              show={showGlm}
              onToggle={() => setShowGlm((v) => !v)}
              onChange={(v) => updateSettings({ glm_api_key: v })}
              placeholder="xxxxx.xxxxx"
            />
            <KeyField
              label="OpenAI (可选,兜底)"
              hint="海外用户使用 GPT-4o 时必填"
              value={settings.openai_api_key}
              show={showOpenai}
              onToggle={() => setShowOpenai((v) => !v)}
              onChange={(v) => updateSettings({ openai_api_key: v })}
              placeholder="sk-..."
            />
            <KeyField
              label="Google Gemini (可选,评估对比)"
              hint="评估脚本用"
              value={settings.gemini_api_key}
              show={showGemini}
              onToggle={() => setShowGemini((v) => !v)}
              onChange={(v) => updateSettings({ gemini_api_key: v })}
              placeholder="AI..."
            />
          </div>
        </section>

        {/* Global shortcut */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Keyboard size={14} /> 全局快捷键
          </h3>
          <div className="flex items-center gap-2">
            <Input
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              onBlur={handleSaveShortcut}
              placeholder="Ctrl+Shift+O"
              className="font-mono"
            />
            <span className="text-xs text-muted-foreground">
              格式: Ctrl+Shift+O
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            可用修饰键: Ctrl/Cmd/Alt/Shift/Option/Super;按键: A-Z, 0-9, F1-F12。
          </p>
        </section>

        {/* Behavior */}
        <section>
          <h3 className="mb-3 text-sm font-semibold">行为</h3>
          <div className="space-y-2">
            <Toggle
              label="识别完成后自动保存到历史"
              checked={settings.auto_save}
              onChange={(v) => updateSettings({ auto_save: v })}
            />
            <Toggle
              label="识别完成后自动复制到剪贴板"
              checked={settings.auto_copy}
              onChange={(v) => updateSettings({ auto_copy: v })}
            />
            <Toggle
              label="默认开启深度思考 (复杂版面)"
              checked={settings.thinking_by_default}
              onChange={(v) => updateSettings({ thinking_by_default: v })}
            />
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>主题</span>
              <select
                value={settings.theme}
                onChange={(e) =>
                  updateSettings({ theme: e.target.value as "dark" | "light" | "system" })
                }
                className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
              >
                <option value="dark">深色</option>
                <option value="light">浅色</option>
                <option value="system">跟随系统</option>
              </select>
            </label>
          </div>
        </section>

        {/* Custom prompt */}
        <section>
          <details>
            <summary className="cursor-pointer text-sm font-semibold">
              自定义 Prompt (高级)
            </summary>
            <p className="mt-1 text-xs text-muted-foreground">
              留空使用默认 prompt ({DEFAULT_PROMPT.slice(0, 30)}...)。修改后评估集
              会标记为 "custom" 版本,方便对比。
            </p>
            <Textarea
              value={settings.prompt_override}
              onChange={(e) => updateSettings({ prompt_override: e.target.value })}
              className="mt-2 min-h-[120px] text-xs"
              placeholder={DEFAULT_PROMPT}
            />
          </details>
        </section>
      </div>
    </Dialog>
  );
}

function KeyField({
  label,
  hint,
  value,
  show,
  onToggle,
  onChange,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  show: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <div className="flex gap-2">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono"
        />
        <Button variant="outline" size="icon" onClick={onToggle} aria-label="toggle visibility">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </Button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm cursor-pointer">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-primary"
      />
    </label>
  );
}
