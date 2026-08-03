/**
 * Character Error Rate and friends — pure TS implementation.
 *
 * Definitions:
 *   CER = (S + D + I) / N
 *   where N = ground-truth length, S/D/I = substitutions/deletions/insertions.
 *
 * Implementation: Wagner-Levenshtein with backtrace for component breakdown.
 * We also expose lineAccuracy (1.0 when a line exactly matches GT) and a
 * normalized Markdown-AST similarity using a simple heuristic
 * (split on whitespace, compare token multisets).
 */

export interface Alignment {
  cer: number;
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  exactMatch: boolean;
  lineAccuracy: number;
}

/** Levenshtein with op counts. */
function levenshteinWithOps(a: string, b: string) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return { subs: 0, dels: 0, ins: n, total: n };
  if (n === 0) return { subs: 0, dels: m, ins: 0, total: m };

  // dp[i][j] = { cost, ops }
  // We carry only counts, not backtrace — simpler and enough for CER.
  const dp: Array<{ s: number; d: number; i: number; t: number }> = new Array(
    (m + 1) * (n + 1),
  );
  const idx = (i: number, j: number) => i * (n + 1) + j;

  for (let i = 0; i <= m; i++) {
    dp[idx(i, 0)] = { s: 0, d: i, i: 0, t: i };
  }
  for (let j = 0; j <= n; j++) {
    dp[idx(0, j)] = { s: 0, d: 0, i: j, t: j };
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[idx(i, j)] = dp[idx(i - 1, j - 1)];
      } else {
        const sub = dp[idx(i - 1, j - 1)];
        const del = dp[idx(i - 1, j)];
        const ins = dp[idx(i, j - 1)];
        const subCost = sub.t + 1;
        const delCost = del.t + 1;
        const insCost = ins.t + 1;
        if (subCost <= delCost && subCost <= insCost) {
          dp[idx(i, j)] = { s: sub.s + 1, d: sub.d, i: sub.i, t: subCost };
        } else if (delCost <= insCost) {
          dp[idx(i, j)] = { s: del.s, d: del.d + 1, i: del.i, t: delCost };
        } else {
          dp[idx(i, j)] = { s: ins.s, d: ins.d, i: ins.i + 1, t: insCost };
        }
      }
    }
  }
  const r = dp[idx(m, n)];
  return { subs: r.s, dels: r.d, ins: r.i, total: r.t };
}

/**
 * Main entrypoint. Returns all metrics for a prediction vs. ground truth.
 */
export function align(pred: string, truth: string): Alignment {
  const norm = (s: string) =>
    s
      .replace(/\r\n/g, "\n")
      .replace(/ /g, " ")
      .replace(/[ \t]+$/gm, "")
      .trim();

  const p = norm(pred);
  const t = norm(truth);

  if (t.length === 0) {
    return {
      cer: p.length === 0 ? 0 : 1,
      wer: p.length === 0 ? 0 : 1,
      substitutions: 0,
      deletions: 0,
      insertions: p.length,
      exactMatch: p.length === 0,
      lineAccuracy: p.length === 0 ? 1 : 0,
    };
  }

  const charRes = levenshteinWithOps(p, t);
  const cer = charRes.total / t.length;

  const pWords = p.split(/\s+/).filter(Boolean);
  const tWords = t.split(/\s+/).filter(Boolean);
  const wordRes =
    tWords.length === 0
      ? { total: pWords.length }
      : levenshteinWithOps(pWords.join(""), tWords.join(""));
  const wer = tWords.length === 0 ? (pWords.length === 0 ? 0 : 1) : wordRes.total / tWords.length;

  // Line accuracy — fraction of ground-truth lines that exactly appear in prediction.
  const tLines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const pSet = new Set(p.split("\n").map((l) => l.trim()));
  const matched = tLines.filter((l) => pSet.has(l)).length;
  const lineAccuracy = tLines.length === 0 ? 0 : matched / tLines.length;

  return {
    cer,
    wer,
    substitutions: charRes.subs,
    deletions: charRes.dels,
    insertions: charRes.ins,
    exactMatch: p === t,
    lineAccuracy,
  };
}

/** Quick CLI smoke test: `tsx scripts/eval/compute-cer.ts a.txt b.txt` */
if (process.argv[1]?.endsWith("compute-cer.ts")) {
  const [aPath, bPath] = process.argv.slice(2);
  if (!aPath || !bPath) {
    console.error("Usage: compute-cer.ts <predicted.txt> <truth.txt>");
    process.exit(1);
  }
  import("node:fs").then((fs) => {
    const pred = fs.readFileSync(aPath, "utf8");
    const truth = fs.readFileSync(bPath, "utf8");
    const r = align(pred, truth);
    console.log(JSON.stringify({ ...r, accuracy: 1 - r.cer }, null, 2));
  });
}
