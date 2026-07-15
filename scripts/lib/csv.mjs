// Shared CSV/data-prep helpers for the one-shot build-time scripts
// (csv-to-mocks.ts, csv-to-new-templates.mjs). Plain ESM so both the .mjs
// script and the tsx-run .ts script can import it.

/**
 * Parse CSV text into rows of string fields. Supports multi-line quoted
 * fields and "" escapes; strips \r.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuoted = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (inQuoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuoted = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Build a stable template id from a name and 1-based index.
 * @param {string} name
 * @param {number} idx
 * @returns {string}
 */
export function slugify(name, idx) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `tpl-${idx.toString().padStart(4, "0")}-${base || "untitled"}`;
}
