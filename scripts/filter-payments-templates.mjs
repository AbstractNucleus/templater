// One-shot: back up the live templates.json, then rewrite it with only
// withdrawal/deposit-related entries (matched by name or any tag).
//
// Run: node scripts/filter-payments-templates.mjs

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const appData = process.env.APPDATA;
if (!appData) {
  console.error("APPDATA env var not set; aborting.");
  process.exit(1);
}

const dir = join(appData, "com.noel.templatewidget");
const file = join(dir, "templates.json");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = join(dir, `templates.json.full-backup-${stamp}`);

copyFileSync(file, backup);
console.log(`Backed up to ${backup}`);

const raw = readFileSync(file, "utf8");
const data = JSON.parse(raw);

const NEEDLE = /withdraw|deposit/i;

const matched = data.templates.filter((t) => {
  if (NEEDLE.test(t.name)) return true;
  if (Array.isArray(t.tags) && t.tags.some((tag) => NEEDLE.test(tag))) return true;
  return false;
});

console.log(`Matched ${matched.length} of ${data.templates.length} templates.`);
for (const t of matched) console.log(`  - ${t.name}`);

const next = { ...data, templates: matched };
writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
console.log(`Wrote ${matched.length} templates to ${file}`);
