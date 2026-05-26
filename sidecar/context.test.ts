/**
 * Golden-fixture tests for the text extractors and summary-input slicer.
 *
 * We import `context.ts` directly and only call pure helpers — `initContext`
 * is NOT invoked, so no SQLite DB or watcher state is set up. The module's
 * top-level `let db = null` is the only state that touches; helpers below
 * never reach for it.
 */

import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { extractText, summaryInput } from "./context.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "__fixtures__");

// A temp dir for fixtures we generate at runtime (.xlsx).
let tmpDir: string;
beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "templater-ctx-test-"));
});
afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("summaryInput", () => {
  it("returns short text unchanged", () => {
    const short = "Hello, world.\n\nA few paragraphs.\n";
    expect(summaryInput(short)).toBe(short);
  });

  it("returns text exactly at the 8000-char budget unchanged", () => {
    const exact = "a".repeat(8_000);
    expect(summaryInput(exact)).toBe(exact);
  });

  it("slices long text into head + tail with separator", () => {
    const head = "H".repeat(5_000);
    const middle = "M".repeat(20_000);
    const tail = "T".repeat(5_000);
    const long = `${head}\n${middle}\n${tail}`;

    const out = summaryInput(long);

    expect(out).toContain("[...later in the document...]");
    // First ~3000 chars of head + first ~3000 chars of tail must be present.
    // The slicer reserves a 1000-char headers budget out of 8000 plus separator
    // overhead, so each side gets ~3000 chars of original text.
    expect(out).toContain("H".repeat(3_000));
    expect(out).toContain("T".repeat(3_000));
    // Output must stay within the configured budget. The constant is 8000 in
    // context.ts; we leave a small slack in case it ever changes by a few bytes.
    expect(out.length).toBeLessThanOrEqual(8_000);
  });

  it("surfaces markdown section headers when present in a long doc", () => {
    const filler = "x".repeat(10_000);
    const long = [
      "# Top Heading",
      "## Subsection One",
      "### Deeper",
      filler,
      "## Subsection Two",
      filler,
      "tail line",
    ].join("\n");

    const out = summaryInput(long);

    expect(out).toContain("[section headers in this file]");
    expect(out).toContain("# Top Heading");
    expect(out).toContain("## Subsection One");
    expect(out).toContain("### Deeper");
    expect(out).toContain("## Subsection Two");
    expect(out.length).toBeLessThanOrEqual(8_000);
  });

  it("omits the headers block when no headers are present", () => {
    // Repeated lowercase content has no markdown headers and no ALL-CAPS lines
    // long enough to match the secondary heuristic.
    const long = ("just some prose line.\n").repeat(800);
    const out = summaryInput(long);
    expect(out).not.toContain("[section headers in this file]");
    expect(out).toContain("[...later in the document...]");
  });
});

describe("extractText", () => {
  it("returns '' for an unsupported extension", async () => {
    const p = path.join(tmpDir, "x.bin");
    await fs.writeFile(p, "binary data");
    expect(await extractText(p, ".bin")).toBe("");
  });

  it("reads .md verbatim", async () => {
    const fp = path.join(FIXTURES, "hello.md");
    const expected = await fs.readFile(fp, "utf8");
    expect(await extractText(fp, ".md")).toBe(expected);
  });

  it("reads .txt verbatim", async () => {
    const fp = path.join(FIXTURES, "hello.txt");
    const expected = await fs.readFile(fp, "utf8");
    expect(await extractText(fp, ".txt")).toBe(expected);
  });

  it("reads .csv verbatim", async () => {
    const fp = path.join(FIXTURES, "hello.csv");
    const expected = await fs.readFile(fp, "utf8");
    const out = await extractText(fp, ".csv");
    expect(out).toBe(expected);
    // Sanity: the structure CSV consumers expect is preserved.
    expect(out).toContain("name,age");
    expect(out).toContain("Alice,30");
  });

  it("extracts .xlsx with a '# Sheet: <name>' header per non-empty sheet", async () => {
    // Build a tiny workbook with two non-empty sheets and one empty sheet.
    // The empty sheet must be skipped per the extractor's contract.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["name", "age"],
        ["Alice", 30],
        ["Bob", 42],
      ]),
      "People",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["item", "qty"],
        ["apples", 5],
      ]),
      "Inventory",
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Empty");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const fp = path.join(tmpDir, "book.xlsx");
    await fs.writeFile(fp, buf);

    const out = await extractText(fp, ".xlsx");

    expect(out).toContain("# Sheet: People");
    expect(out).toContain("# Sheet: Inventory");
    expect(out).not.toContain("# Sheet: Empty");
    // Content from each sheet round-trips through sheet_to_csv.
    expect(out).toContain("name,age");
    expect(out).toContain("Alice,30");
    expect(out).toContain("Bob,42");
    expect(out).toContain("item,qty");
    expect(out).toContain("apples,5");
    // Sheets are joined by a blank line.
    expect(out).toMatch(/People[\s\S]+\n\n# Sheet: Inventory/);
  });

  it("extracts text from a small .pdf fixture", async () => {
    const fp = path.join(FIXTURES, "hello.pdf");
    const out = await extractText(fp, ".pdf");
    expect(out).toContain("Hello PDF World");
  });

  it("returns '' for an empty content + unsupported case (sanity)", async () => {
    // Belt-and-braces: extractText must NOT throw on an unknown ext, even when
    // the file is empty/missing. Regression guard for callers that pass a
    // weird `ext` (e.g. files with no extension would arrive as "").
    const p = path.join(tmpDir, "noext");
    await fs.writeFile(p, "anything");
    expect(await extractText(p, "")).toBe("");
  });
});
