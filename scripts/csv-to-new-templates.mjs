// Parse the Intercom saved-replies CSV into a new_templates.json file using
// the same on-disk format as %APPDATA%/com.noel.templatewidget/templates.json.
//
// Run: node scripts/csv-to-new-templates.mjs
//
// Auto-categorization: maps the CSV row by title + body keywords to one or
// more tags. Anything that doesn't match a known category gets ["uncategorized"].

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, slugify } from "./lib/csv.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const CSV_PATH =
  "C:\\Users\\noelh\\Downloads\\Intercom_saved_replies_18th February 2026 13_18 + New Client Macros - New Client MACROs (1).csv";
const OUT_PATH = join(root, "new_templates.json");

const GREETING_RE = /^\s*(hello|hi|hey|thanks for reaching out|thank you for)\b[,!.\s]*$/i;
const SIMPLE_GREETING_RE = /^\s*(hello|hi|hey)\b[,!.\s]*$/i;

const CLOSER_RES = [
  /^if you (need|have) any\b/i,
  /^if you have any\b/i,
  /^if anything else\b/i,
  /^if you would (need|have)\b/i,
  /^if there.s anything else\b/i,
  /^should you (require|need|have)\b/i,
  /^thank you (for your patience|once again|for your cooperation|for your understanding|for understanding)/i,
  /^thanks for your patience\b/i,
  /^best of luck\b/i,
  /^best regards\b/i,
  /^kind regards\b/i,
  /^cheers\b/i,
  /^we (truly )?appreciate\b/i,
  /^we appreciate your (patience|understanding|cooperation)/i,
  /^let us know if\b/i,
  /^please let us know\b/i,
  /^feel free to (let us|reach|contact)/i,
  /^we look forward\b/i,
  /^we hope (this|the above)/i,
];

function extractOpeningAndSignature(body) {
  const lines = body.split("\n");

  let opening = "";
  let start = 0;
  // Find the first non-empty line. If it (or a sub-string of it) is a simple
  // greeting, pull it as opening. Tolerate stray leading punctuation like ". Hello,".
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") {
      start = i + 1;
      continue;
    }
    const cleaned = raw.replace(/^[\s.\-:;]+/, "").trim();
    if (SIMPLE_GREETING_RE.test(cleaned)) {
      opening = cleaned;
      start = i + 1;
    }
    break;
  }

  // Find the last non-empty line; if it matches a closer pattern, pull as sig.
  let end = lines.length;
  let signature = "";
  for (let i = lines.length - 1; i >= start; i--) {
    const line = lines[i];
    if (line.trim() === "") {
      end = i;
      continue;
    }
    const trimmed = line.trim();
    if (CLOSER_RES.some((re) => re.test(trimmed))) {
      signature = trimmed;
      end = i;
    }
    break;
  }

  const trimmedBody = lines
    .slice(start, end)
    .join("\n")
    .replace(/^\s*\n+/, "")
    .replace(/\n+\s*$/, "");

  return { opening, body: trimmedBody, signature };
}

function parseDate(raw) {
  const fallback = "2026-05-20T00:00:00Z";
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  // ISO already? (e.g. 2026-02-14T15:45:10.000Z)
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (iso) {
    return trimmed.endsWith("Z") ? trimmed : trimmed + "Z";
  }

  // DD/MM or DD/MM/YYYY or D/M/YYYY
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return fallback;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  let year = m[3] ?? "2026";
  if (year.length === 2) year = "20" + year;
  return `${year}-${month}-${day}T00:00:00Z`;
}

// Categorization rules. Each rule is checked against the lower-cased name
// (+ a snippet of body). Multiple tags are allowed. Order matters only for
// the "luxon" + secondary tag combination.
// NOTE: run-once / disposable data-prep logic — intentionally not refactored.
function categorize(name, body, csvCategory) {
  const lcName = name.toLowerCase();
  const lcBody = body.toLowerCase();
  const text = lcName + "\n" + lcBody;
  const tags = new Set();

  // Use the CSV's explicit category when it's a clean tag.
  const knownCsvCategories = {
    poker: "poker",
    casino: "casino",
    deposits: "deposits",
    "account issues": "account",
    "feature disabling": "account",
  };
  const cat = csvCategory.trim().toLowerCase();
  if (knownCsvCategories[cat]) {
    tags.add(knownCsvCategories[cat]);
  }

  // Luxon: anything mentioning Luxon Pay
  const isLuxon = /luxon/.test(text);
  if (isLuxon) tags.add("luxon");

  // Withdrawals — only when the NAME is about a withdrawal (not "withdrawable
  // balance" mentioned inside a Cashier/balance explainer).
  if (
    /\bwithdrawal\b/i.test(lcName) ||
    /\bwithdrawals\b/i.test(lcName) ||
    /withdraw via|how to withdraw|missing withdrawal|btc withdrawal/i.test(lcName)
  ) {
    tags.add("withdrawals");
  }

  // Deposits — name-driven only
  if (
    /\bdeposit\b/i.test(lcName) ||
    /\bdeposits\b/i.test(lcName) ||
    /credit card deposit|bank card deposit|locate missing deposit|deposit issue|deposit limit|unsupported network/i.test(
      lcName,
    )
  ) {
    tags.add("deposits");
  }

  // Bonuses
  if (
    /bonus|welcome bonus|free spins|casino welcome|poker welcome/i.test(lcName) ||
    /casino bonus/i.test(lcName)
  ) {
    tags.add("bonuses");
  }

  // Promotions / rewards
  if (
    /rakeback|coinraces|coinrewards|splash pot|daily guaranteed|micro stakes fees|high stakes poker rewards|leaderboard/i.test(
      lcName,
    )
  ) {
    tags.add("promotions");
  }

  // CHP / migration topics
  if (
    /\bchp\b/i.test(lcName) ||
    /existing usdt|migration|tournament tickets|crypto futures|chp|sit n go|sit & go|spin n go|spin & go/i.test(
      lcName,
    )
  ) {
    if (/\bchp\b/i.test(lcName) || /migration|existing|tournament tickets|crypto futures/i.test(lcName)) {
      tags.add("migration");
    }
  }

  // Tournaments
  if (
    /tournament|mtt|satellite|wpm|world poker masters|icm refund|final table|ft blind/i.test(
      lcName,
    )
  ) {
    tags.add("tournaments");
  }

  // Poker product topics — keyed mostly off the NAME so we don't pull in
  // generic troubleshooting templates that happen to mention "tables".
  const pokerName =
    /\bplo\b|\bnlh\b|bomb pot|all.in or fold|\baof\b|ev cashout|ev cash out|run it twice|\brit\b|i.rit|hand history|hole cards|\brake\b|rakeback|chip offload|bubble protection|splash pot|spin.n.go|sit.n.go|spin & go|sit & go|turbo|cash game|poker variant|world poker masters|freeroll|bad beat|run meter|t icon|\bplayer.s notes|reveal hole|coinrace|leaderboard|satellite|tournament|mtt|\bicm\b|blind|wpm|cgwc|\bpoker\b/i.test(
      lcName,
    );
  const pokerBody =
    /\bplo\b|\bnlh\b|bomb pot|all.in or fold|hand history|hole cards|ev cashout|run it twice|chip offload|bubble protection/i.test(
      lcBody,
    );
  if (pokerName || (pokerBody && /poker|hand/i.test(lcName))) {
    if (
      !tags.has("withdrawals") &&
      !tags.has("deposits") &&
      !/cashier|withdrawable balance|promotional balance|p2p|player to player/i.test(
        lcName,
      )
    ) {
      tags.add("poker");
    }
  }

  // Casino
  if (/casino/i.test(lcName) && !lcName.includes("welcome")) tags.add("casino");

  // Sportsbook
  if (/sportsbook|bet/i.test(lcName)) tags.add("sportsbook");

  // Balances / transactions overview
  const isTransactionsTopic =
    /cashier|total balance|withdrawable balance|promotional balance|rewards balance|p2p|player to player|deposits\.?\/withdrawals|coins enquiry|deposits and withdrawals|deposit & withdrawal|deposits\/withdrawals/i.test(
      lcName,
    );
  if (isTransactionsTopic) {
    tags.add("transactions");
    // These overview templates shouldn't also be tagged as withdrawals/deposits
    // unless the name clearly says "Withdrawal" or "Deposit" as a primary topic.
    if (!/\bwithdrawal\b/i.test(lcName)) tags.delete("withdrawals");
    if (!/\bdeposit\b/i.test(lcName) || /deposits & withdraw|deposits\/withdraw|deposit & withdrawal/i.test(lcName)) {
      // For the combined "Deposit & Withdrawal" overview, prefer the broader transactions tag.
      if (/&|and|\//.test(lcName) && /deposit/i.test(lcName) && /withdraw/i.test(lcName)) {
        tags.delete("deposits");
        tags.delete("withdrawals");
      }
    }
  }

  // Escalations / forwarded / pending review
  if (
    /forwarded|escalat|pending review|pending slack|specialist queue|tech - collecting/i.test(
      lcName,
    )
  ) {
    tags.add("escalations");
  }

  // Account / login / username / device
  if (
    /login|sign up|sign-up|otp|username|password|metamask|nickname|device|account closure|reinstatement|blocked account|abusive|offensive|soda communication|account|new user login/i.test(
      lcName,
    )
  ) {
    tags.add("account");
  }

  // Technical / tech
  if (
    /^tech|isp block|security message|vpn|system error|client interface|3rd party statement|audit|download|app logs|remote access|teamviewer|anydesk|tech -|tech /i.test(
      lcName,
    )
  ) {
    tags.add("technical");
  }

  // Responsible gaming
  if (/deposit limit|poker break|timeout|self-?exclusion|responsible gaming/i.test(lcName)) {
    tags.add("responsible gaming");
  }

  // KYC
  if (/\bkyc\b/i.test(lcName)) tags.add("KYC");

  // Affiliate / promotions team
  if (/affiliate|corey eyring|mario|triton/i.test(lcName)) tags.add("affiliate");

  // CGWC
  if (/cgwc|world championship/i.test(lcName)) tags.add("cgwc");

  // RNG questions
  if (/\brng\b/i.test(lcName)) tags.add("technical");

  // Refund / sportsbook refund
  if (/refund/i.test(lcName)) {
    tags.add("refunds");
  }

  // Freeroll
  if (/freeroll/i.test(lcName)) tags.add("poker");

  // Feedback
  if (/feedback/i.test(lcName)) tags.add("uncategorized");

  // Coins (rake/coins enquiry topic)
  if (/\bcoins\b/i.test(lcName) && !/coinraces|coinrewards|coinpoker/i.test(lcName)) {
    tags.add("poker");
  }

  // Old hand histories / migration of old data
  if (/old transactions|hh unavailable|hand history/i.test(lcName)) {
    tags.add("poker");
    if (/old|unavailable|previous/i.test(lcName)) tags.add("migration");
  }

  // Bug/bounty
  if (/bug.?bounty|bounty reward/i.test(lcName)) tags.add("account");

  // India / restricted territory
  if (/india|indian|restricted territory|playing from xxx|no real money|valentina/i.test(lcName)) {
    tags.add("restricted regions");
  }

  // Newsletters / communication
  if (/unsubscribe|newsletter|auto-generated email|push notifications/i.test(lcName)) {
    tags.add("account");
  }

  // Avatar / personalisation
  if (/avatar|profile picture/i.test(lcName)) tags.add("account");

  // Targeted promo - unmatched -> promotions
  if (/targeted promotion/i.test(lcName)) tags.add("promotions");

  if (tags.size === 0) tags.add("uncategorized");

  // Order tags for readability
  const orderedTagPriority = [
    "deposits",
    "withdrawals",
    "transactions",
    "bonuses",
    "promotions",
    "luxon",
    "poker",
    "casino",
    "sportsbook",
    "tournaments",
    "account",
    "technical",
    "escalations",
    "refunds",
    "migration",
    "responsible gaming",
    "KYC",
    "cgwc",
    "affiliate",
    "restricted regions",
    "uncategorized",
  ];

  const sorted = [...tags].sort((a, b) => {
    const ai = orderedTagPriority.indexOf(a);
    const bi = orderedTagPriority.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  // Strip "uncategorized" if any other tag is present.
  if (sorted.length > 1 && sorted.includes("uncategorized")) {
    return sorted.filter((t) => t !== "uncategorized");
  }
  return sorted;
}

function main() {
  const csv = readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new Error("CSV had zero rows.");

  rows.shift(); // header

  const templates = [];
  let skipped = 0;

  rows.forEach((cols, idx) => {
    const name = (cols[0] ?? "").trim();
    const createdRaw = cols[1] ?? "";
    const updatedRaw = cols[2] ?? "";
    const rawBody = (cols[3] ?? "").replace(/\r/g, "");
    const category = (cols[4] ?? "").trim();

    if (name === "" || rawBody.trim() === "") {
      skipped++;
      return;
    }

    const { opening, body, signature } = extractOpeningAndSignature(rawBody);
    const tags = categorize(name, body, category);

    templates.push({
      id: slugify(name, idx + 1),
      name,
      tags,
      opening: opening || "Hello,",
      body: body.trim(),
      signature,
      created_at: parseDate(createdRaw),
      updated_at: parseDate(updatedRaw),
    });
  });

  const fileContent = {
    version: 1,
    templates,
    settings: {
      always_on_top_default: false,
      global_hotkey: "Ctrl+Shift+Backslash",
      start_minimised_to_tray: false,
      window_geometry: { x: -4, y: 36, width: 3848, height: 2128 },
      close_hint_shown: true,
      global_signature: "",
      theme: "dark",
    },
  };

  writeFileSync(OUT_PATH, JSON.stringify(fileContent, null, 2), "utf8");

  // Summarize categorization
  const tagCounts = {};
  for (const t of templates) {
    for (const tag of t.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
  }
  const summary = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `  ${t}: ${n}`)
    .join("\n");

  console.log(
    `Wrote ${templates.length} templates to ${OUT_PATH} (skipped ${skipped} empty rows).\n` +
      `Tag distribution:\n${summary}`,
  );
}

main();
