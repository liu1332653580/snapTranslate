/**
 * Run the eval: invoke each provider on every sample, compute CER/WER/etc.,
 * and write a Markdown + JSON report.
 *
 * Usage:
 *   GLM_API_KEY=... OPENAI_API_KEY=... npm run eval
 *   GLM_API_KEY=... npm run eval -- --provider=glm-4.6v-flash
 *   npm run eval -- --limit=20
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  EvalConfig,
  EvalProviderConfig,
  EvalReport,
  EvalSample,
  ProviderStats,
  SampleResult,
  CategoryStats,
} from "./types";
import { align } from "./compute-cer";

const DATASETS_DIR = path.resolve(process.cwd(), "datasets");
const INDEX_PATH = path.join(DATASETS_DIR, "index.json");
const OUT_DIR = path.resolve(process.cwd(), "eval-results");

const DEFAULT_PROMPT = `You are SnapOCR, an OCR engine tuned for screenshots. Extract every piece of text from the image and return it as Markdown.

1. Output pure Markdown. Preserve layout: headings, lists, code blocks, tables, blockquotes.
2. Wrap code in fenced blocks with the correct language tag.
3. Render tables as GitHub-flavored Markdown tables.
4. Math: inline as $...$, display as $$...$$.
5. If unreadable or unsure, write [?].
6. Do NOT add commentary or summaries.
7. Do NOT wrap output in outer code fences.
8. Preserve original spelling, punctuation, casing.

Return only the Markdown.`;

const DEFAULT_PROVIDERS: EvalProviderConfig[] = [
  {
    name: "GLM-4.6V-Flash",
    provider: "glm",
    model: "glm-4.6v-flash",
    apiKeyEnv: "GLM_API_KEY",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  },
  {
    name: "GLM-4.6V",
    provider: "glm",
    model: "glm-4.6v",
    apiKeyEnv: "GLM_API_KEY",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  },
  {
    name: "GPT-4o",
    provider: "openai",
    model: "gpt-4o",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1/chat/completions",
  },
  {
    name: "Gemini-2.0-Flash",
    provider: "gemini",
    model: "gemini-2.0-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
  },
];

function parseArgs(): { providerFilter?: string; limit?: number; thinking: boolean } {
  const args = process.argv.slice(2);
  let providerFilter: string | undefined;
  let limit: number | undefined;
  let thinking = false;
  for (const a of args) {
    if (a.startsWith("--provider=")) providerFilter = a.slice("--provider=".length);
    if (a.startsWith("--limit=")) limit = Number(a.slice("--limit=".length));
    if (a === "--thinking") thinking = true;
  }
  return { providerFilter, limit, thinking };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function stripFences(s: string): string {
  const t = s.trim();
  if (t.startsWith("```") && t.endsWith("```")) {
    const firstNewline = t.indexOf("\n");
    if (firstNewline > 0) {
      const inner = t.slice(firstNewline + 1, t.length - 3);
      return inner.trim();
    }
  }
  return t;
}

async function callProvider(
  cfg: EvalProviderConfig,
  imageB64: string,
  prompt: string,
  thinking: boolean,
): Promise<{
  text: string;
  usage: { prompt: number; completion: number; total: number };
  latencyMs: number;
}> {
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey) throw new Error(`missing env ${cfg.apiKeyEnv}`);

  const started = Date.now();
  let resp: Response;
  let body: string;

  if (cfg.provider === "gemini") {
    resp = await fetch(`${cfg.baseUrl}?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "image/png", data: imageB64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
    });
    body = await resp.text();
    if (!resp.ok) throw new Error(`gemini ${resp.status}: ${body.slice(0, 300)}`);
    const parsed = JSON.parse(body);
    const text = stripFences(
      parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
    );
    const usage = {
      prompt: parsed?.usageMetadata?.promptTokenCount ?? 0,
      completion: parsed?.usageMetadata?.candidatesTokenCount ?? 0,
      total: parsed?.usageMetadata?.totalTokenCount ?? 0,
    };
    return { text, usage, latencyMs: Date.now() - started };
  }

  // OpenAI-compatible (GLM, OpenAI)
  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/png;base64,${imageB64}` } },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 4096,
    stream: false,
  };
  if (cfg.provider === "glm" && thinking) payload.thinking = true;

  resp = await fetch(cfg.baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  body = await resp.text();
  if (!resp.ok) throw new Error(`${cfg.name} ${resp.status}: ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body);
  const text = stripFences(parsed?.choices?.[0]?.message?.content ?? "");
  const usage = {
    prompt: parsed?.usage?.prompt_tokens ?? 0,
    completion: parsed?.usage?.completion_tokens ?? 0,
    total: parsed?.usage?.total_tokens ?? 0,
  };
  return { text, usage, latencyMs: Date.now() - started };
}

function estimateCostCny(cfg: EvalProviderConfig, usage: { prompt: number; completion: number }): number {
  const inT = usage.prompt / 1_000_000;
  const outT = usage.completion / 1_000_000;
  if (cfg.provider === "glm") {
    return cfg.model.includes("flash") ? 0 : inT * 1 + outT * 3;
  }
  if (cfg.provider === "openai") {
    const inP = cfg.model.includes("mini") ? 0.15 : 2.5;
    const outP = cfg.model.includes("mini") ? 0.6 : 10;
    return (inT * inP + outT * outP) * 7.2;
  }
  return (inT * 0.1 + outT * 0.4) * 7.2;
}

async function main() {
  const { providerFilter, limit, thinking } = parseArgs();

  let providers = DEFAULT_PROVIDERS;
  if (providerFilter) providers = providers.filter((p) => p.name === providerFilter);
  if (providers.length === 0) {
    console.error("no providers selected. Check --provider filter or env keys.");
    process.exit(1);
  }
  console.log(`Providers: ${providers.map((p) => p.name).join(", ")}`);

  console.log(`Loading dataset index from ${INDEX_PATH}`);
  const indexRaw = await fs.readFile(INDEX_PATH, "utf8");
  const index = JSON.parse(indexRaw) as { samples: EvalSample[] };
  let samples = index.samples;
  if (limit && limit > 0) {
    samples = samples.slice(0, limit);
  }
  console.log(`Samples: ${samples.length}`);

  const config: EvalConfig = {
    providers,
    promptVersion: "snapocr-v1",
    thinking,
    temperature: 0.1,
    maxTokens: 4096,
  };

  const allResults: SampleResult[] = [];

  for (const sample of samples) {
    const img = await fs.readFile(sample.imagePath);
    const imgB64 = img.toString("base64");
    console.log(`\n→ ${sample.id} [${sample.category}]`);

    for (const cfg of providers) {
      const tag = `${cfg.name}`;
      try {
        const r = await callProvider(cfg, imgB64, DEFAULT_PROMPT, thinking);
        const al = align(r.text, sample.groundTruth);
        const sr: SampleResult = {
          sampleId: sample.id,
          provider: cfg.name,
          model: cfg.model,
          prediction: r.text,
          latencyMs: r.latencyMs,
          costCny: estimateCostCny(cfg, r.usage),
          usage: r.usage,
          cer: al.cer,
          wer: al.wer,
          lineAccuracy: al.lineAccuracy,
          exactMatch: al.exactMatch,
        };
        allResults.push(sr);
        console.log(
          `  ${tag.padEnd(22)} CER=${(al.cer * 100).toFixed(2)}%  acc=${(
            (1 - al.cer) *
            100
          ).toFixed(2)}%  ${r.latencyMs}ms  ${al.exactMatch ? "✓" : ""}`,
        );
      } catch (e) {
        const sr: SampleResult = {
          sampleId: sample.id,
          provider: cfg.name,
          model: cfg.model,
          prediction: "",
          latencyMs: 0,
          costCny: 0,
          usage: { prompt: 0, completion: 0, total: 0 },
          cer: 1,
          wer: 1,
          lineAccuracy: 0,
          exactMatch: false,
          error: (e as Error).message,
        };
        allResults.push(sr);
        console.error(`  ${tag}  ERROR: ${(e as Error).message}`);
      }
    }
  }

  // Aggregate.
  const perProvider: ProviderStats[] = providers.map((cfg) => {
    const rs = allResults.filter((r) => r.provider === cfg.name);
    const cers = rs.map((r) => r.cer);
    return {
      provider: cfg.name,
      model: cfg.model,
      count: rs.length,
      meanCer: cers.reduce((a, b) => a + b, 0) / Math.max(1, cers.length),
      medianCer: median(cers),
      p99Cer: percentile(cers, 99),
      exactMatchRate: rs.filter((r) => r.exactMatch).length / Math.max(1, rs.length),
      meanLatencyMs: rs.reduce((a, b) => a + b.latencyMs, 0) / Math.max(1, rs.length),
      totalCostCny: rs.reduce((a, b) => a + b.costCny, 0),
      totalTokens: rs.reduce((a, b) => a + b.usage.total, 0),
    };
  });

  const perCategory: CategoryStats[] = [];
  for (const cfg of providers) {
    for (const cat of Array.from(new Set(samples.map((s) => s.category)))) {
      const rs = allResults.filter(
        (r) => r.provider === cfg.name && r.sampleId.startsWith(`${cat}/`),
      );
      if (rs.length === 0) continue;
      const cers = rs.map((r) => r.cer);
      perCategory.push({
        category: cat,
        provider: cfg.name,
        meanCer: cers.reduce((a, b) => a + b, 0) / cers.length,
        count: rs.length,
      });
    }
  }

  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    promptVersion: config.promptVersion,
    thinking: config.thinking,
    perProvider,
    perCategory,
    samples: allResults,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(OUT_DIR, `report-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `report-${stamp}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  await fs.writeFile(mdPath, renderMarkdown(report));

  console.log(`\n✓ reports written:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);

  // Print a small summary table.
  console.log("\n=== Summary ===");
  console.log(
    "provider".padEnd(22) +
      "mean CER".padStart(12) +
      "accuracy".padStart(12) +
      "exact".padStart(8) +
      "latency".padStart(10) +
      "cost¥".padStart(10),
  );
  for (const p of perProvider) {
    console.log(
      p.provider.padEnd(22) +
        `${(p.meanCer * 100).toFixed(2)}%`.padStart(12) +
        `${((1 - p.meanCer) * 100).toFixed(2)}%`.padStart(12) +
        `${(p.exactMatchRate * 100).toFixed(0)}%`.padStart(8) +
        `${p.meanLatencyMs.toFixed(0)}ms`.padStart(10) +
        p.totalCostCny.toFixed(2).padStart(10),
    );
  }
}

function renderMarkdown(r: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# SnapOCR Eval Report`);
  lines.push(`Generated: ${r.generatedAt}  ·  Prompt: ${r.promptVersion}  ·  Thinking: ${r.thinking}`);
  lines.push("");
  lines.push("## Per-provider summary");
  lines.push("| Provider | Mean CER | Accuracy | Median CER | Exact Match | Mean Latency | Total Cost (¥) |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const p of r.perProvider) {
    lines.push(
      `| ${p.provider} | ${(p.meanCer * 100).toFixed(3)}% | ${((1 - p.meanCer) * 100).toFixed(3)}% | ${(
        p.medianCer * 100
      ).toFixed(3)}% | ${(p.exactMatchRate * 100).toFixed(1)}% | ${p.meanLatencyMs.toFixed(0)}ms | ${p.totalCostCny.toFixed(3)} |`,
    );
  }
  lines.push("");
  lines.push("## Per-category CER");
  lines.push("| Category | Provider | Mean CER | Accuracy | Samples |");
  lines.push("|---|---|---|---|---|");
  for (const c of r.perCategory) {
    lines.push(
      `| ${c.category} | ${c.provider} | ${(c.meanCer * 100).toFixed(3)}% | ${(
        (1 - c.meanCer) *
        100
      ).toFixed(3)}% | ${c.count} |`,
    );
  }
  lines.push("");
  lines.push("## Outliers (highest CER)");
  const worst = [...r.samples].sort((a, b) => b.cer - a.cer).slice(0, 10);
  lines.push("| Sample | Provider | CER | Note |");
  lines.push("|---|---|---|---|");
  for (const s of worst) {
    lines.push(
      `| ${s.sampleId} | ${s.provider} | ${(s.cer * 100).toFixed(2)}% | ${s.error ?? ""} |`,
    );
  }
  return lines.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
