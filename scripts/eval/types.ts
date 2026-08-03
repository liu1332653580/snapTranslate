/**
 * Eval framework types — shared by prepare-dataset.ts, run-eval.ts, and
 * compute-cer.ts. Kept in plain TS so we don't pull in tauri-apps types here.
 */

export interface EvalSample {
  id: string;
  imagePath: string;
  /** Markdown — the human-verified correct answer. */
  groundTruth: string;
  /** Category bucket for slicing the report. */
  category: "chinese" | "english" | "mixed" | "code" | "table" | "list" | "emoji" | "low-res";
  source?: string;
}

export interface EvalConfig {
  providers: EvalProviderConfig[];
  promptVersion: string;
  thinking: boolean;
  temperature: number;
  maxTokens: number;
  /** How many samples to run; 0 = all. */
  sampleLimit?: number;
  /** Skip samples by id (e.g. ones that hang on a particular model). */
  skip?: string[];
}

export interface EvalProviderConfig {
  name: string;
  provider: "glm" | "openai" | "gemini";
  model: string;
  apiKeyEnv: string;
  baseUrl: string;
}

export interface SampleResult {
  sampleId: string;
  provider: string;
  model: string;
  prediction: string;
  latencyMs: number;
  costCny: number;
  usage: { prompt: number; completion: number; total: number };
  cer: number;
  wer: number;
  /** 0–1 — how many lines exactly match ground truth. */
  lineAccuracy: number;
  /** 0–1 — strict: full document matches. */
  exactMatch: boolean;
  error?: string;
}

export interface EvalReport {
  generatedAt: string;
  promptVersion: string;
  thinking: boolean;
  perProvider: ProviderStats[];
  perCategory: CategoryStats[];
  samples: SampleResult[];
}

export interface ProviderStats {
  provider: string;
  model: string;
  count: number;
  meanCer: number;
  medianCer: number;
  p99Cer: number;
  exactMatchRate: number;
  meanLatencyMs: number;
  totalCostCny: number;
  totalTokens: number;
}

export interface CategoryStats {
  category: EvalSample["category"];
  provider: string;
  meanCer: number;
  count: number;
}
