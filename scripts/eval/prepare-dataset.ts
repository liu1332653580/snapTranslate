/**
 * Prepare the eval dataset.
 *
 * Expected layout under `datasets/`:
 *   datasets/
 *     screenshots/<category>/<id>.png
 *     ground-truth/<category>/<id>.txt
 *
 * This script:
 *   1. Validates every screenshot has a matching ground-truth file.
 *   2. Computes basic stats (count per category).
 *   3. Generates `datasets/index.json` consumed by run-eval.ts.
 *
 * Run after dropping new screenshots into datasets/screenshots.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { EvalSample } from "./types";

const DATASETS_DIR = path.resolve(process.cwd(), "datasets");
const SHOTS_DIR = path.join(DATASETS_DIR, "screenshots");
const TRUTH_DIR = path.join(DATASETS_DIR, "ground-truth");

const CATEGORIES = [
  "chinese",
  "english",
  "mixed",
  "code",
  "table",
  "list",
  "emoji",
  "low-res",
] as const;

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function main() {
  const samples: EvalSample[] = [];
  const missing: string[] = [];

  for (const category of CATEGORIES) {
    const catShotDir = path.join(SHOTS_DIR, category);
    const catTruthDir = path.join(TRUTH_DIR, category);
    const shots = (await walk(catShotDir)).filter((f) => f.endsWith(".png"));
    for (const shotPath of shots) {
      const id = path.basename(shotPath, ".png");
      const truthPath = path.join(catTruthDir, `${id}.txt`);
      try {
        await fs.access(truthPath);
        const groundTruth = await fs.readFile(truthPath, "utf8");
        samples.push({
          id: `${category}/${id}`,
          imagePath: shotPath,
          groundTruth,
          category,
          source: "manual",
        });
      } catch {
        missing.push(shotPath);
      }
    }
  }

  if (missing.length > 0) {
    console.warn(`⚠️  ${missing.length} screenshot(s) missing ground-truth:`);
    for (const m of missing.slice(0, 20)) console.warn(`   ${m}`);
    if (missing.length > 20) console.warn(`   ... and ${missing.length - 20} more`);
  }

  const index = {
    generatedAt: new Date().toISOString(),
    totalSamples: samples.length,
    byCategory: CATEGORIES.reduce(
      (acc, c) => {
        acc[c] = samples.filter((s) => s.category === c).length;
        return acc;
      },
      {} as Record<string, number>,
    ),
    samples,
  };

  const indexPath = path.join(DATASETS_DIR, "index.json");
  await fs.mkdir(DATASETS_DIR, { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));

  console.log(`✓ dataset index written: ${indexPath}`);
  console.log(`  total: ${samples.length}`);
  for (const [cat, n] of Object.entries(index.byCategory)) {
    console.log(`  ${cat}: ${n}`);
  }

  if (samples.length < 50) {
    console.warn(
      `\n⚠️  Only ${samples.length} samples. For trustworthy accuracy metrics, target ≥100 across 8 categories.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
