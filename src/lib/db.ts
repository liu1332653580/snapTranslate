/**
 * Database access. In Tauri we use `tauri-plugin-sql` with migrations defined
 * in Rust (src-tauri/src/lib.rs). In web-dev mode we shim the same surface
 * against localStorage so the History panel works.
 */

import type { CaptureRow } from "./types";
import { isTauri } from "./utils";
import Database from "@tauri-apps/plugin-sql";

export interface ListFilter {
  search?: string;
  onlyStarred?: boolean;
  model?: string;
  limit?: number;
  offset?: number;
}

export async function listCaptures(filter: ListFilter = {}): Promise<CaptureRow[]> {
  if (!isTauri()) {
    return listCapturesWeb(filter);
  }
  const db = await Database.load("sqlite:snapocr.db");

  const where: string[] = ["is_deleted = 0"];
  const params: unknown[] = [];

  if (filter.search) {
    where.push("(raw_text LIKE ? OR edited_text LIKE ?)");
    params.push(`%${filter.search}%`, `%${filter.search}%`);
  }
  if (filter.onlyStarred) {
    where.push("is_starred = 1");
  }
  if (filter.model) {
    where.push("model = ?");
    params.push(filter.model);
  }

  const limit = filter.limit ?? 100;
  const offset = filter.offset ?? 0;
  params.push(limit, offset);

  const rows = await db.select<CaptureRow[]>(
    `SELECT * FROM captures WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params,
  );

  await db.close();
  return rows.map(normalizeBool);
}

export async function getCapture(id: string): Promise<CaptureRow | null> {
  if (!isTauri()) {
    const all = await listCapturesWeb({});
    return all.find((r) => r.id === id) ?? null;
  }
  const db = await Database.load("sqlite:snapocr.db");
  const rows = await db.select<CaptureRow[]>(
    "SELECT * FROM captures WHERE id = ? LIMIT 1",
    [id],
  );
  await db.close();
  return rows[0] ? normalizeBool(rows[0]) : null;
}

/**
 * Insert a new capture row. The Rust backend emits a `persist-capture` event
 * with the prepared row; this function does the actual INSERT so the connection
 * pool stays single-owner.
 */
export async function insertCapture(row: CaptureRow): Promise<void> {
  if (!isTauri()) return;
  const db = await Database.load("sqlite:snapocr.db");
  await db.execute(
    `INSERT INTO captures
      (id, created_at, image_path, image_width, image_height, model, thinking,
       latency_ms, tokens_input, tokens_output, cost_cny, raw_text, edited_text,
       prompt_version, source, tags, is_starred, is_deleted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $7, 0)`,
    [
      row.id,
      row.created_at,
      row.image_path,
      row.image_width,
      row.image_height,
      row.model,
      row.thinking ? 1 : 0,
      row.latency_ms,
      row.tokens_input,
      row.tokens_output,
      row.cost_cny,
      row.raw_text,
      row.edited_text,
      row.prompt_version,
      row.source,
      row.tags,
    ],
  );
  await db.close();
}

export async function softDeleteCapture(id: string): Promise<void> {
  if (!isTauri()) return;
  const db = await Database.load("sqlite:snapocr.db");
  await db.execute("UPDATE captures SET is_deleted = 1 WHERE id = $1", [id]);
  await db.close();
}

export async function hardDeleteCapture(id: string): Promise<void> {
  if (!isTauri()) return;
  const db = await Database.load("sqlite:snapocr.db");
  await db.execute("DELETE FROM captures WHERE id = $1", [id]);
  await db.close();
}

export async function updateRow(
  id: string,
  field: "edited_text" | "tags" | "is_starred",
  value: string,
): Promise<void> {
  if (!isTauri()) return;
  const db = await Database.load("sqlite:snapocr.db");
  if (field === "is_starred") {
    await db.execute("UPDATE captures SET is_starred = $1 WHERE id = $2", [
      value === "true" ? 1 : 0,
      id,
    ]);
  } else {
    await db.execute(`UPDATE captures SET ${field} = $1 WHERE id = $2`, [value, id]);
  }
  await db.close();
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function normalizeBool(row: CaptureRow): CaptureRow {
  // SQLite booleans come through as 0/1 — normalize for the UI.
  return { ...row, thinking: !!row.thinking, is_starred: !!row.is_starred };
}

// ---------------------------------------------------------------------------
//  Web fallback — store history in localStorage so dev mode reflects state.
// ---------------------------------------------------------------------------

const LS_KEY = "snapocr-mock-history";

function readWebHistory(): CaptureRow[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as CaptureRow[]) : [];
  } catch {
    return [];
  }
}

async function listCapturesWeb(filter: ListFilter): Promise<CaptureRow[]> {
  let rows = readWebHistory();
  if (filter.search) {
    const q = filter.search.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.raw_text.toLowerCase().includes(q) ||
        (r.edited_text ?? "").toLowerCase().includes(q),
    );
  }
  if (filter.onlyStarred) rows = rows.filter((r) => r.is_starred);
  if (filter.model) rows = rows.filter((r) => r.model === filter.model);
  return rows
    .slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 100))
    .map(normalizeBool);
}
