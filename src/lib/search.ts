import type { Template } from "./types";

/**
 * Scored literal-mode search across name + tags + body.
 *
 * Per-word score is the MAX of the matching field (not the sum) — matching in
 * all three fields doesn't make a template 2× better; the strongest signal
 * wins. Multi-word queries are OR'd, but ordering puts full matches first:
 * primary sort is the number of query words that matched (descending), so
 * templates hitting every word land above partial matches regardless of how
 * strong any single field signal was. Templates matching zero words are
 * dropped.
 */

/** Inclusive-start / exclusive-end range into a source string. */
export interface TextRange {
  start: number;
  end: number;
}

/** Name match ranges — same shape as body ranges (`TextRange`). */
export type NameHit = TextRange;

export interface SearchHit {
  template: Template;
  score: number;
  /** How many of the query's whitespace-separated words matched anywhere. */
  matchedWords: number;
  /** Sorted, non-overlapping ranges in `template.name` that matched. */
  nameHits: NameHit[];
  /** Tags (lowercased) that contributed to the match. */
  tagHits: string[];
  /**
   * One-line excerpt of the body centered on the first matched word, broken
   * into hit/non-hit segments for highlighted rendering. Null when no body
   * word matched. The sidebar only renders this when the name itself didn't
   * match — otherwise the name highlight already explains the hit.
   */
  bodyHit: BodyHit | null;
}

export interface BodyHit {
  segments: NameSegment[];
}

const SCORE_NAME = 100;
const SCORE_NAME_WORD_BOUNDARY_BONUS = 30;
const SCORE_TAG_EXACT = 80;
const SCORE_TAG_CONTAINS = 50;
const SCORE_BODY = 20;

const WORD_CHAR = /[a-z0-9]/;

export function searchTemplates(query: string, templates: Template[]): SearchHit[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") {
    // Preserve input order; no highlights to compute.
    return templates.map((t) => ({
      template: t,
      score: 0,
      matchedWords: 0,
      nameHits: [],
      tagHits: [],
      bodyHit: null,
    }));
  }

  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);

  const results: SearchHit[] = [];

  for (const t of templates) {
    const nameLower = t.name.toLowerCase();
    const bodyLower = t.body.toLowerCase();
    const tagsLower = t.tags.map((tag) => tag.toLowerCase());

    let total = 0;
    let matchedWords = 0;
    const nameHits: NameHit[] = [];
    const tagHitSet = new Set<string>();
    let earliestBodyPos = -1;

    for (const word of words) {
      let wordScore = 0;

      // Name — collect every occurrence for highlighting, score once.
      let nameMatched = false;
      let nameBoundaryMatch = false;
      let pos = nameLower.indexOf(word);
      while (pos >= 0) {
        nameHits.push({ start: pos, end: pos + word.length });
        nameMatched = true;
        const prev = pos === 0 ? null : nameLower[pos - 1];
        if (prev === null || !WORD_CHAR.test(prev)) nameBoundaryMatch = true;
        pos = nameLower.indexOf(word, pos + word.length);
      }
      if (nameMatched) {
        wordScore = Math.max(
          wordScore,
          SCORE_NAME + (nameBoundaryMatch ? SCORE_NAME_WORD_BOUNDARY_BONUS : 0),
        );
      }

      // Tags
      for (const tag of tagsLower) {
        if (tag === word) {
          wordScore = Math.max(wordScore, SCORE_TAG_EXACT);
          tagHitSet.add(tag);
        } else if (tag.includes(word)) {
          wordScore = Math.max(wordScore, SCORE_TAG_CONTAINS);
          tagHitSet.add(tag);
        }
      }

      // Body — track the earliest hit across all words so we can centre the
      // excerpt on it.
      const bodyPos = bodyLower.indexOf(word);
      if (bodyPos >= 0) {
        wordScore = Math.max(wordScore, SCORE_BODY);
        if (earliestBodyPos < 0 || bodyPos < earliestBodyPos) earliestBodyPos = bodyPos;
      }

      if (wordScore > 0) {
        matchedWords += 1;
        total += wordScore;
      }
    }

    if (matchedWords > 0) {
      const bodyHit =
        earliestBodyPos >= 0
          ? buildBodyHit(t.body, bodyLower, words, earliestBodyPos)
          : null;
      results.push({
        template: t,
        score: total,
        matchedWords,
        nameHits: mergeOverlapping(nameHits),
        tagHits: [...tagHitSet],
        bodyHit,
      });
    }
  }

  // Primary: more matched words first (full matches above partial).
  // Secondary: total score (field strength) within the same band.
  // Tertiary: name asc as a stable tiebreak.
  results.sort((a, b) => {
    if (b.matchedWords !== a.matchedWords) return b.matchedWords - a.matchedWords;
    if (b.score !== a.score) return b.score - a.score;
    return a.template.name.localeCompare(b.template.name);
  });

  return results;
}

function mergeOverlapping(hits: NameHit[]): NameHit[] {
  if (hits.length === 0) return hits;
  const sorted = [...hits].sort((a, b) => a.start - b.start);
  const out: NameHit[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      out.push({ ...sorted[i] });
    }
  }
  return out;
}

/** Walk sorted, non-overlapping `ranges` over `text`, emitting `hit(range)`
 *  for each range and `miss(slice)` for the gaps between and around them.
 *  Shared by name-highlighting and the body-excerpt builder. */
function segmentize<T, R extends { start: number; end: number }>(
  text: string,
  ranges: R[],
  hit: (range: R) => T,
  miss: (slice: string) => T,
): T[] {
  const out: T[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) out.push(miss(text.slice(cursor, r.start)));
    out.push(hit(r));
    cursor = r.end;
  }
  if (cursor < text.length) out.push(miss(text.slice(cursor)));
  return out;
}

// Excerpt window around the first body hit. Wide enough to give context on
// both sides at typical column widths; CSS ellipsis trims the visible end.
const EXCERPT_BEFORE = 30;
const EXCERPT_LEN = 100;

function buildBodyHit(
  body: string,
  bodyLower: string,
  words: string[],
  firstPos: number,
): BodyHit | null {
  const start = Math.max(0, firstPos - EXCERPT_BEFORE);
  const end = Math.min(body.length, start + EXCERPT_LEN);
  const excerpt = body.slice(start, end);
  const excerptLower = bodyLower.slice(start, end);

  const ranges: NameHit[] = [];
  for (const word of words) {
    let p = excerptLower.indexOf(word);
    while (p >= 0) {
      ranges.push({ start: p, end: p + word.length });
      p = excerptLower.indexOf(word, p + word.length);
    }
  }
  if (ranges.length === 0) return null;
  const merged = mergeOverlapping(ranges);

  const segments: NameSegment[] = [];
  if (start > 0) segments.push({ text: "…", hit: false });
  segments.push(
    ...segmentize<NameSegment, NameHit>(
      excerpt,
      merged,
      (r) => ({ text: excerpt.slice(r.start, r.end), hit: true }),
      (text) => ({ text, hit: false }),
    ),
  );
  if (end < body.length) segments.push({ text: "…", hit: false });

  return { segments };
}

/** Split a name into segments for highlighted rendering. */
export interface NameSegment {
  text: string;
  hit: boolean;
}

export function highlightName(name: string, hits: NameHit[]): NameSegment[] {
  if (hits.length === 0) return [{ text: name, hit: false }];
  return segmentize<NameSegment, NameHit>(
    name,
    hits,
    (h) => ({ text: name.slice(h.start, h.end), hit: true }),
    (text) => ({ text, hit: false }),
  );
}
