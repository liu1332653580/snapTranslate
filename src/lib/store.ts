/**
 * Global app state via Zustand. Components subscribe to slices; the actions
 * below are the only way to mutate. Persisted settings live in
 * `lib/settings.ts` — this store is purely in-memory session state.
 */

import { create } from "zustand";
import type { CaptureRow, RecognizeResponse, Provider } from "./types";
import { DEFAULT_SETTINGS, type Settings, loadSettings, saveSettings } from "./settings";
import { DEFAULT_PROMPT, PROMPT_VERSION } from "./types";

export type CapturePhase =
  | { kind: "idle" }
  | { kind: "capturing" }
  | { kind: "selecting"; dataUrl: string; imageWidth: number; imageHeight: number }
  | { kind: "recognizing"; dataUrl: string }
  | { kind: "done"; dataUrl: string; result: RecognizeResponse }
  | { kind: "error"; message: string };

interface AppState {
  // settings
  settings: Settings;
  settingsLoaded: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;

  // capture flow
  phase: CapturePhase;
  setPhase: (phase: CapturePhase) => void;

  // current result + capture row (post-save)
  current: CaptureRow | null;
  setCurrent: (row: CaptureRow | null) => void;

  // history list cache
  history: CaptureRow[];
  historyLoading: boolean;
  historyFilter: { search: string; onlyStarred: boolean; model: string };
  setHistoryFilter: (patch: Partial<{ search: string; onlyStarred: boolean; model: string }>) => void;
  refreshHistory: () => Promise<void>;

  // selection
  selectedModelId: string;
  selectedProvider: Provider;
  thinkingEnabled: boolean;
  setSelectedModel: (modelId: string, provider: Provider) => void;
  toggleThinking: () => void;

  // toast
  toast: { id: number; message: string; variant: "info" | "success" | "error" } | null;
  showToast: (message: string, variant?: "info" | "success" | "error") => void;
  clearToast: () => void;
}

let toastSeq = 0;

export const useAppStore = create<AppState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,

  async loadSettings() {
    const s = await loadSettings();
    set({
      settings: s,
      settingsLoaded: true,
      selectedModelId: s.default_model,
      selectedProvider: s.default_provider,
      thinkingEnabled: s.thinking_by_default,
    });
  },

  async updateSettings(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await saveSettings(next);
  },

  phase: { kind: "idle" },
  setPhase: (phase) => set({ phase }),

  current: null,
  setCurrent: (current) => set({ current }),

  history: [],
  historyLoading: false,
  historyFilter: { search: "", onlyStarred: false, model: "" },
  setHistoryFilter: (patch) =>
    set((s) => ({ historyFilter: { ...s.historyFilter, ...patch } })),
  async refreshHistory() {
    set({ historyLoading: true });
    try {
      const { listCaptures } = await import("./db");
      const filter = get().historyFilter;
      const rows = await listCaptures(filter);
      set({ history: rows, historyLoading: false });
    } catch (e) {
      console.error("refreshHistory failed", e);
      set({ historyLoading: false });
    }
  },

  selectedModelId: DEFAULT_SETTINGS.default_model,
  selectedProvider: DEFAULT_SETTINGS.default_provider,
  thinkingEnabled: DEFAULT_SETTINGS.thinking_by_default,
  setSelectedModel: (modelId, provider) =>
    set({ selectedModelId: modelId, selectedProvider: provider }),
  toggleThinking: () => set((s) => ({ thinkingEnabled: !s.thinkingEnabled })),

  toast: null,
  showToast: (message, variant = "info") => {
    const id = ++toastSeq;
    set({ toast: { id, message, variant } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3500);
  },
  clearToast: () => set({ toast: null }),
}));

/** Build the final prompt: user override if present, else the default. */
export function getEffectivePrompt(settings: Settings): string {
  return settings.prompt_override?.trim() || DEFAULT_PROMPT;
}

export function getPromptVersion(settings: Settings): string {
  return settings.prompt_override?.trim() ? "custom" : PROMPT_VERSION;
}
