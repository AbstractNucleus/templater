/**
 * Context corpus: indexed reference material the AI consults during adapt + edit.
 *
 * Architecture: per-file rows in SQLite (`context.db`) keyed by absolute path.
 * Ingest pipeline runs on add/mtime-change: extract text (md / pdf / xlsx),
 * Haiku-summarize, upsert. A chokidar watcher per source root keeps the index
 * live; the picker (Haiku) selects 0-3 relevant files at adapt/edit time and
 * their text is injected into the main draft call's system prompt.
 */

import chokidar, { type FSWatcher } from "chokidar";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// pdf-parse's index does an end-to-end test on import that crashes outside its
// own folder. Bypass it by loading the underlying module directly.
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buf: Uint8Array,
  opts?: Record<string, unknown>,
) => Promise<{ text: string; numpages: number }>;
const XLSX = require("xlsx") as typeof import("xlsx");

/** File types we attempt to ingest. Anything else is silently skipped. */
const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".pdf", ".xlsx", ".xls", ".csv"]);

/** Directories ignored during scan. Reduces noise from common dev/git debris. */
const IGNORED_DIR_NAMES = new Set([".git", ".obsidian", "node_modules", ".cache", ".next", "dist", "build", "target", ".vscode", ".idea"]);

/** Hard cap on text stored per file. Prevents a 500-page PDF from blowing the row. */
const MAX_FILE_TEXT_CHARS = 200_000;

/** What `readContextFile` returns. Sized to fit a few files in a Sonnet system prompt. */
const MAX_READ_CHARS = 30_000;

/** How many chars of file text we send to Haiku for summarization. */
const MAX_SUMMARY_INPUT_CHARS = 8_000;

/** Default number of files the picker selects per adapt/edit call. */
const DEFAULT_PICK_K = 3;

/** Hard cap on files sent to the picker. Past this, prefilter by keyword overlap. */
const MAX_PICKER_CANDIDATES = 200;

/** Concurrent ingest workers. Higher = faster cold start, more Haiku spend in bursts. */
const INGEST_CONCURRENCY = 4;

export type FileStatus = "pending" | "ingested" | "failed";

export interface FileRow {
  path: string;
  source_root: string;
  mtime_ms: number;
  size_bytes: number;
  ext: string;
  extracted_text: string;
  summary: string;
  tags: string[];
  status: FileStatus;
  error: string | null;
  ingested_at: number | null;
}

export interface SourceStatus {
  path: string;
  file_count: number;
  ingested_count: number;
  failed_count: number;
  pending_count: number;
  last_ingested_at: number | null;
  exists: boolean;
}

export interface ContextStatus {
  sources: SourceStatus[];
  /** Files currently in the ingest queue (waiting or in flight). */
  in_flight: number;
}

export interface PickedFile {
  path: string;
  summary: string;
  tags: string[];
  reason: string;
  /** Full extracted text (capped). Pre-loaded so callers don't need a second round trip. */
  text: string;
}

export type Summarizer = (text: string, filename: string) => Promise<{ summary: string; tags: string[] }>;
export type Picker = (query: string, candidates: PickerCandidate[], k: number) => Promise<PickResult[]>;
export type MemoryExtractor = (raw: string) => Promise<{ signal: string; title: string }>;

export interface PickerCandidate {
  path: string;
  filename: string;
  summary: string;
  tags: string[];
}

export interface PickResult {
  path: string;
  reason: string;
}

let db: DatabaseSync | null = null;
/** Suppress the "experimental feature" warning that node:sqlite emits on import. */
const watchers = new Map<string, FSWatcher>();
let activeSources: string[] = [];

const ingestQueue: Array<{ path: string; sourceRoot: string }> = [];
let ingestInFlight = 0;
const queuedSet = new Set<string>();

let summarizer: Summarizer | null = null;

/**
 * Open / create the index database and prepare tables. Call once at startup.
 */
export function initContext(dbPath: string, summarizerFn: Summarizer): void {
  // Defensive: the Rust spawner already ensures the data dir exists, but a
  // dev smoke test pointing at a fresh path would otherwise crash here.
  const dir = path.dirname(dbPath);
  if (dir && dir !== ".") {
    try {
      require("node:fs").mkdirSync(dir, { recursive: true });
    } catch {
      /* fall through — DatabaseSync will surface the real error */
    }
  }
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      source_root TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      ext TEXT NOT NULL,
      extracted_text TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      ingested_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_files_source ON files(source_root);
    CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
  `);
  summarizer = summarizerFn;
}

function requireDb(): DatabaseSync {
  if (!db) throw new Error("context not initialized");
  return db;
}

/**
 * Replace the active source list. Stops watchers for removed roots (and purges
 * their rows), starts watchers for new roots and kicks off an initial scan.
 * Idempotent for roots already active.
 */
export async function setSources(sources: string[]): Promise<void> {
  const normalized = sources.map(normalizePath);
  const next = new Set(normalized);
  const prev = new Set(activeSources);
  const removed = activeSources.filter((s) => !next.has(s));
  const added = normalized.filter((s) => !prev.has(s));

  // Update activeSources synchronously, before any await, so concurrent
  // maybeEnqueue / ingestFile / in-flight scanSource calls see the new state
  // and short-circuit work for removed sources. Otherwise a fire-and-forget
  // walk or queued file would keep ingesting after the user removed its root.
  activeSources = normalized;

  // Drop queued entries for removed sources. Done synchronously after the
  // activeSources swap so a parallel drainQueue tick sees neither the queue
  // entry nor an active source.
  for (let i = ingestQueue.length - 1; i >= 0; i--) {
    const entry = ingestQueue[i];
    if (!next.has(entry.sourceRoot)) {
      queuedSet.delete(entry.path);
      ingestQueue.splice(i, 1);
    }
  }

  for (const r of removed) {
    const w = watchers.get(r);
    if (w) {
      await w.close().catch(() => undefined);
      watchers.delete(r);
    }
    // Purge all rows under this source; user removed it, they want it gone.
    requireDb().prepare("DELETE FROM files WHERE source_root = ?").run(r);
  }

  for (const a of added) {
    await startWatcher(a);
    // Fire-and-forget the walk so a large folder add doesn't block the IPC
    // response past the 30s sidecar timeout. Files trickle in via the ingest
    // queue; the UI polls contextStatus() to track progress.
    void scanSource(a);
  }
}

/**
 * Walk a source root and enqueue any file that's new or has changed mtime.
 * Skips files that already match the indexed mtime.
 */
export async function scanSource(sourceRoot: string): Promise<void> {
  const normalized = normalizePath(sourceRoot);
  const exists = await pathExists(normalized);
  if (!exists) return;
  for await (const file of walk(normalized)) {
    maybeEnqueue(file, normalized);
  }
}

/** Force re-ingest of one source: drops mtime-matches gate by clearing rows first.
 *  Walk runs in the background — see `setSources` for rationale. */
export async function rescanSource(sourceRoot: string): Promise<void> {
  const normalized = normalizePath(sourceRoot);
  requireDb().prepare("DELETE FROM files WHERE source_root = ?").run(normalized);
  void scanSource(normalized);
}

/** Force re-ingest of every active source. */
export async function rescanAll(): Promise<void> {
  for (const s of activeSources) {
    await rescanSource(s);
  }
}

export function contextStatus(): ContextStatus {
  const d = requireDb();
  const sources: SourceStatus[] = [];
  for (const root of activeSources) {
    const total = d.prepare("SELECT COUNT(*) AS c FROM files WHERE source_root = ?").get(root) as { c: number };
    const ingested = d.prepare("SELECT COUNT(*) AS c FROM files WHERE source_root = ? AND status = 'ingested'").get(root) as { c: number };
    const failed = d.prepare("SELECT COUNT(*) AS c FROM files WHERE source_root = ? AND status = 'failed'").get(root) as { c: number };
    const pending = d.prepare("SELECT COUNT(*) AS c FROM files WHERE source_root = ? AND status = 'pending'").get(root) as { c: number };
    const lastRow = d.prepare("SELECT MAX(ingested_at) AS t FROM files WHERE source_root = ?").get(root) as { t: number | null };
    sources.push({
      path: root,
      file_count: total.c,
      ingested_count: ingested.c,
      failed_count: failed.c,
      pending_count: pending.c,
      last_ingested_at: lastRow.t,
      // Synchronous check is fine — paths are short and this is called from UI polls only.
      exists: existsSyncSafe(root),
    });
  }
  return { sources, in_flight: ingestQueue.length + ingestInFlight };
}

export function contextListFiles(sourceRoot?: string): FileRow[] {
  const d = requireDb();
  const rows = sourceRoot
    ? d.prepare("SELECT * FROM files WHERE source_root = ? ORDER BY path").all(normalizePath(sourceRoot))
    : d.prepare("SELECT * FROM files ORDER BY path").all();
  return (rows as Array<Record<string, unknown>>).map(rowToFile);
}

export function readContextFile(filePath: string): { path: string; text: string; truncated: boolean } | null {
  const d = requireDb();
  const row = d.prepare("SELECT path, extracted_text FROM files WHERE path = ?").get(normalizePath(filePath)) as
    | { path: string; extracted_text: string }
    | undefined;
  if (!row) return null;
  const truncated = row.extracted_text.length > MAX_READ_CHARS;
  return {
    path: row.path,
    text: truncated ? row.extracted_text.slice(0, MAX_READ_CHARS) : row.extracted_text,
    truncated,
  };
}

/**
 * Search the index by keyword overlap. Cheap scoring over (summary + tags +
 * filename + extracted_text). Used by the context pane UI to let the user
 * browse what's indexed; the picker (used for adapt/edit) uses Haiku ranking
 * instead.
 */
export function searchContextFiles(query: string, limit = 30): Array<FileRow & { score: number }> {
  const d = requireDb();
  const words = tokenize(query);
  const allRows = d
    .prepare("SELECT * FROM files WHERE status = 'ingested' ORDER BY path")
    .all() as Array<Record<string, unknown>>;
  const scored = allRows
    .map(rowToFile)
    .map((row) => ({ ...row, score: scoreRow(row, words) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}

/**
 * Pick the most relevant files for the given query (inbound text for adapt,
 * user prompt for edit). Returns 0..k files with their full extracted text
 * pre-loaded — the caller injects these into the draft call's system prompt.
 *
 * No-op (returns []) when no sources are configured or the index is empty.
 */
export async function pickRelevantFiles(
  query: string,
  picker: Picker,
  k = DEFAULT_PICK_K,
): Promise<PickedFile[]> {
  const d = requireDb();
  const allRows = d
    .prepare("SELECT path, summary, tags FROM files WHERE status = 'ingested' AND summary != ''")
    .all() as Array<{ path: string; summary: string; tags: string }>;
  if (allRows.length === 0) return [];

  // Prefilter when over the picker's budget. Keyword overlap is a coarse
  // ranker; Haiku gets the top N to make the actual judgement call.
  let candidates: PickerCandidate[] = allRows.map((r) => ({
    path: r.path,
    filename: path.basename(r.path),
    summary: r.summary,
    tags: safeParseTags(r.tags),
  }));
  if (candidates.length > MAX_PICKER_CANDIDATES) {
    const words = tokenize(query);
    candidates = candidates
      .map((c) => ({ c, s: scoreCandidate(c, words) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_PICKER_CANDIDATES)
      .map((x) => x.c);
  }

  let picks: PickResult[];
  try {
    picks = await picker(query, candidates, k);
  } catch {
    // Picker failed (auth, network) — gracefully degrade to no context rather
    // than failing the whole adapt/edit call.
    return [];
  }

  const out: PickedFile[] = [];
  for (const p of picks.slice(0, k)) {
    const row = d
      .prepare("SELECT path, summary, tags, extracted_text FROM files WHERE path = ?")
      .get(normalizePath(p.path)) as
      | { path: string; summary: string; tags: string; extracted_text: string }
      | undefined;
    if (!row) continue;
    out.push({
      path: row.path,
      summary: row.summary,
      tags: safeParseTags(row.tags),
      reason: p.reason,
      text: row.extracted_text.slice(0, MAX_READ_CHARS),
    });
  }
  return out;
}

/**
 * Distill a pasted Slack/email/etc snippet into durable signal and write it
 * as a new file `<sourceRoot>/memory/YYYY-MM-DD-<slug>.md` with YAML
 * frontmatter (title, created). Ingest runs in the background so the caller's
 * popover can show the signal immediately and poll for indexing status.
 */
export async function captureMemory(
  raw: string,
  sourceRoot: string,
  extractor: MemoryExtractor,
): Promise<{ appendedTo: string; signal: string; title: string }> {
  const normalizedRoot = normalizePath(sourceRoot);
  if (!activeSources.includes(normalizedRoot)) {
    throw new Error(`source root not active: ${sourceRoot}`);
  }
  if (!(await pathExists(normalizedRoot))) {
    throw new Error(`source root does not exist: ${sourceRoot}`);
  }
  const { signal: rawSignal, title: rawTitle } = await extractor(raw);
  const signal = rawSignal.trim();
  if (signal.length === 0) {
    throw new Error("memory extractor returned empty signal");
  }
  const title = rawTitle.trim() || "untitled";
  const memoryDir = normalizePath(path.join(normalizedRoot, "memory"));
  await fs.mkdir(memoryDir, { recursive: true });
  const now = new Date();
  const datePrefix = now.toISOString().slice(0, 10);
  const slug = slugifyTitle(title);
  const finalPath = await resolveCapturePath(memoryDir, datePrefix, slug);
  const body = `---\ntitle: ${escapeYaml(title)}\ncreated: ${now.toISOString()}\n---\n\n${signal}\n`;
  // Park the path in queuedSet so chokidar's add event (fired by the write)
  // doesn't double-enqueue alongside the direct ingestFile call below.
  queuedSet.add(finalPath);
  await fs.writeFile(finalPath, body, "utf8");
  // Fire-and-forget ingest — capture returns as soon as the file is written.
  // ingestFile updates the SQLite row's status, which the popover polls.
  void ingestFile(finalPath, normalizedRoot).finally(() => {
    queuedSet.delete(finalPath);
  });
  return { appendedTo: finalPath, signal, title };
}

/** Slugify a Haiku-returned title for use in a filename. */
function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : "untitled";
}

/** Resolve `<dir>/<date>-<slug>.md`, appending `-2`, `-3`, ... on collision. */
async function resolveCapturePath(dir: string, datePrefix: string, slug: string): Promise<string> {
  const base = `${datePrefix}-${slug}`;
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? `${base}.md` : `${base}-${i}.md`;
    const candidate = normalizePath(path.join(dir, name));
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("could not find a free capture filename");
}

/** Escape a YAML scalar value. Wraps in double quotes if it contains chars that need it. */
function escapeYaml(value: string): string {
  if (/[:#\[\]{}&*!|>'"%@`,\n]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

async function startWatcher(sourceRoot: string): Promise<void> {
  if (watchers.has(sourceRoot)) return;
  const watcher = chokidar.watch(sourceRoot, {
    ignoreInitial: true,
    ignored: (p) => {
      const base = path.basename(p);
      return base.startsWith(".") || IGNORED_DIR_NAMES.has(base);
    },
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });
  watcher.on("add", (p) => maybeEnqueue(normalizePath(p), sourceRoot));
  watcher.on("change", (p) => maybeEnqueue(normalizePath(p), sourceRoot));
  watcher.on("unlink", (p) => {
    requireDb().prepare("DELETE FROM files WHERE path = ?").run(normalizePath(p));
  });
  watchers.set(sourceRoot, watcher);
}

function maybeEnqueue(filePath: string, sourceRoot: string): void {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) return;
  // Catches stale events from an in-flight scanSource walk or late-firing
  // watcher event after the user removed this source root.
  if (!activeSources.includes(sourceRoot)) return;
  if (queuedSet.has(filePath)) return;
  queuedSet.add(filePath);
  ingestQueue.push({ path: filePath, sourceRoot });
  drainQueue();
}

function drainQueue(): void {
  while (ingestInFlight < INGEST_CONCURRENCY && ingestQueue.length > 0) {
    const next = ingestQueue.shift();
    if (!next) break;
    ingestInFlight++;
    void ingestFile(next.path, next.sourceRoot)
      .catch(() => undefined)
      .finally(() => {
        queuedSet.delete(next.path);
        ingestInFlight--;
        drainQueue();
      });
  }
}

async function ingestFile(filePath: string, sourceRoot: string): Promise<void> {
  // Source may have been removed between enqueue and drain. Without this, the
  // INSERT below would resurrect a row that setSources just purged.
  if (!activeSources.includes(sourceRoot)) return;
  const d = requireDb();
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    // File vanished between enqueue and now.
    d.prepare("DELETE FROM files WHERE path = ?").run(filePath);
    return;
  }
  if (!stat.isFile()) return;
  const mtime_ms = stat.mtimeMs;
  const size_bytes = stat.size;

  const existing = d
    .prepare("SELECT mtime_ms, status FROM files WHERE path = ?")
    .get(filePath) as { mtime_ms: number; status: FileStatus } | undefined;
  if (existing && existing.mtime_ms === mtime_ms && existing.status === "ingested") {
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  // Mark pending so callers can show progress without waiting for completion.
  d.prepare(
    `INSERT INTO files (path, source_root, mtime_ms, size_bytes, ext, extracted_text, summary, tags, status, error, ingested_at)
     VALUES (?, ?, ?, ?, ?, '', '', '[]', 'pending', NULL, NULL)
     ON CONFLICT(path) DO UPDATE SET
       source_root = excluded.source_root,
       mtime_ms = excluded.mtime_ms,
       size_bytes = excluded.size_bytes,
       ext = excluded.ext,
       status = 'pending',
       error = NULL`,
  ).run(filePath, sourceRoot, mtime_ms, size_bytes, ext);

  let extracted: string;
  try {
    extracted = await extractText(filePath, ext);
  } catch (err) {
    d.prepare("UPDATE files SET status = 'failed', error = ?, ingested_at = ? WHERE path = ?").run(
      `extract failed: ${(err as Error).message}`,
      Date.now(),
      filePath,
    );
    return;
  }
  if (extracted.length === 0) {
    d.prepare("UPDATE files SET status = 'failed', error = ?, ingested_at = ? WHERE path = ?").run(
      "no extractable text",
      Date.now(),
      filePath,
    );
    return;
  }
  if (extracted.length > MAX_FILE_TEXT_CHARS) {
    extracted = extracted.slice(0, MAX_FILE_TEXT_CHARS);
  }

  let summary = "";
  let tags: string[] = [];
  if (summarizer) {
    try {
      const result = await summarizer(summaryInput(extracted), path.basename(filePath));
      summary = result.summary;
      tags = result.tags;
    } catch (err) {
      // Summary failure isn't fatal — the row is still queryable by extracted_text.
      // Surface as a soft warning by recording the error.
      d.prepare("UPDATE files SET extracted_text = ?, status = 'failed', error = ?, ingested_at = ? WHERE path = ?").run(
        extracted,
        `summary failed: ${(err as Error).message}`,
        Date.now(),
        filePath,
      );
      return;
    }
  }

  d.prepare(
    `UPDATE files SET extracted_text = ?, summary = ?, tags = ?, status = 'ingested', error = NULL, ingested_at = ? WHERE path = ?`,
  ).run(extracted, summary, JSON.stringify(tags), Date.now(), filePath);
}

/**
 * Pick the slice of extracted text we send to the summarizer. For files
 * within budget, send everything. For longer files, send head + markdown
 * section headers + tail, separated by a marker so the summarizer knows
 * gaps were skipped. Late-document conclusions and section names often
 * carry the real signal — sending only the first 8k chars truncates them.
 */
export function summaryInput(text: string): string {
  if (text.length <= MAX_SUMMARY_INPUT_CHARS) return text;
  // Headroom for separators ("...\n\n[...later...]\n\n...").
  const SEPARATOR = "\n\n[...later in the document...]\n\n";
  const HEADERS_BUDGET = 1_000;
  const remaining = MAX_SUMMARY_INPUT_CHARS - SEPARATOR.length - HEADERS_BUDGET;
  const sliceSize = Math.max(0, Math.floor(remaining / 2));
  const head = text.slice(0, sliceSize);
  const tail = text.slice(text.length - sliceSize);
  // Catches markdown headers (#, ##, ###) and bare ALL-CAPS lines that
  // commonly mark sections in plain-text exports. Cap so we never blow past
  // the budget on a file that's nothing but headings.
  const headerLines: string[] = [];
  let headerChars = 0;
  for (const line of text.split("\n")) {
    if (/^#{1,3}\s+\S/.test(line) || /^[A-Z][A-Z0-9 \-_]{6,}$/.test(line.trim())) {
      if (headerChars + line.length + 1 > HEADERS_BUDGET) break;
      headerLines.push(line.trim());
      headerChars += line.length + 1;
    }
  }
  const headersBlock = headerLines.length > 0
    ? `\n\n[section headers in this file]\n${headerLines.join("\n")}`
    : "";
  return `${head}${headersBlock}${SEPARATOR}${tail}`;
}

export async function extractText(filePath: string, ext: string): Promise<string> {
  if (ext === ".md" || ext === ".markdown" || ext === ".txt" || ext === ".csv") {
    return await fs.readFile(filePath, "utf8");
  }
  if (ext === ".pdf") {
    const buf = await fs.readFile(filePath);
    const result = await pdfParse(new Uint8Array(buf));
    return (result.text ?? "").trim();
  }
  if (ext === ".xlsx" || ext === ".xls") {
    const buf = await fs.readFile(filePath);
    const wb = XLSX.read(buf, { type: "buffer" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim().length > 0) {
        parts.push(`# Sheet: ${name}\n${csv}`);
      }
    }
    return parts.join("\n\n");
  }
  return "";
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".") || IGNORED_DIR_NAMES.has(name)) continue;
    const full = path.join(dir, name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield normalizePath(full);
    }
  }
}

function normalizePath(p: string): string {
  let s = p;
  if (s.startsWith("file://")) {
    try {
      s = fileURLToPath(s);
    } catch {
      // leave as-is
    }
  }
  return path.resolve(s);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function existsSyncSafe(p: string): boolean {
  try {
    require("node:fs").accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function rowToFile(row: Record<string, unknown>): FileRow {
  return {
    path: String(row.path),
    source_root: String(row.source_root),
    mtime_ms: Number(row.mtime_ms),
    size_bytes: Number(row.size_bytes),
    ext: String(row.ext),
    extracted_text: String(row.extracted_text ?? ""),
    summary: String(row.summary ?? ""),
    tags: safeParseTags(String(row.tags ?? "[]")),
    status: (row.status as FileStatus) ?? "pending",
    error: row.error == null ? null : String(row.error),
    ingested_at: row.ingested_at == null ? null : Number(row.ingested_at),
  };
}

function safeParseTags(s: string): string[] {
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v.map(String);
  } catch {
    /* fall through */
  }
  return [];
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 3);
}

function scoreRow(row: FileRow, words: string[]): number {
  if (words.length === 0) return 0;
  const haystack = `${path.basename(row.path)} ${row.summary} ${row.tags.join(" ")} ${row.extracted_text.slice(0, 4000)}`.toLowerCase();
  let score = 0;
  for (const w of words) {
    const matches = haystack.split(w).length - 1;
    score += matches;
  }
  return score;
}

function scoreCandidate(c: PickerCandidate, words: string[]): number {
  if (words.length === 0) return 0;
  const haystack = `${c.filename} ${c.summary} ${c.tags.join(" ")}`.toLowerCase();
  let score = 0;
  for (const w of words) {
    if (haystack.includes(w)) score += 1;
  }
  return score;
}
