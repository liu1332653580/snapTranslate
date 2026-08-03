/**
 * User settings & secrets. We store API keys in `tauri-plugin-store` (encrypted
 * on disk via the OS keychain on macOS / DPAPI on Windows). In web-dev mode we
 * fall back to localStorage so the Settings dialog is fully exercisable.
 */

import { isTauri } from "./utils";
import type { Provider } from "./types";

export interface Settings {
  glm_api_key: string;
  openai_api_key: string;
  gemini_api_key: string;
  default_model: string;
  default_provider: Provider;
  thinking_by_default: boolean;
  auto_save: boolean;
  auto_copy: boolean;
  theme: "dark" | "light" | "system";
  prompt_override: string;
  prompt_version: string;
  /** Per-provider model name overrides (defaults baked in types.ts). */
  model_overrides: Partial<Record<Provider, string>>;
}

export const DEFAULT_SETTINGS: Settings = {
  glm_api_key: "",
  openai_api_key: "",
  gemini_api_key: "",
  default_model: "glm-4.6v-flash",
  default_provider: "glm",
  thinking_by_default: false,
  auto_save: true,
  auto_copy: true,
  theme: "dark",
  prompt_override: "",
  prompt_version: "snapocr-v1",
  model_overrides: {},
};

const LS_KEY = "snapocr-settings";

async function loadStore(): Promise<Record<string, unknown>> {
  if (isTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("settings.json", { autoSave: false });
    const entries = await store.entries();
    const obj: Record<string, unknown> = {};
    for (const [k, v] of entries) obj[k] = v;
    return obj;
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveStore(obj: Record<string, unknown>): Promise<void> {
  if (isTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("settings.json", { autoSave: false });
    for (const [k, v] of Object.entries(obj)) await store.set(k, v);
    await store.save();
    return;
  }
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}

export async function loadSettings(): Promise<Settings> {
  const obj = await loadStore();
  return { ...DEFAULT_SETTINGS, ...(obj as Partial<Settings>) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await saveStore(s as unknown as Record<string, unknown>);
}

export async function getApiKey(provider: Provider): Promise<string> {
  const s = await loadSettings();
  switch (provider) {
    case "glm":
      return s.glm_api_key || "";
    case "openai":
      return s.openai_api_key || "";
    case "gemini":
      return s.gemini_api_key || "";
  }
}
