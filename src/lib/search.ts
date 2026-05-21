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

export interface NameHit {
  /** Inclusive start index into the original `template.name` string. */
  start: number;
  /** Exclusive end index. */
  end: number;
}

export interface SearchHit {
  template: Template;
  score: number;
  /** How many of the query's whitespace-separated words matched anywhere. */
  matchedWords: number;
  /** Sorted, non-overlapping ranges in `template.name` that matched. */
  nameHits: NameHit[];
  /** Tags (lowercased) that contributed to the match. */
  tagHits: string[];
  /** Whether at least one query word was found in the body. */
  hasBodyHit: boolean;
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
      hasBodyHit: false,
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
    let hasBodyHit = false;

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

      // Body
      if (bodyLower.includes(word)) {
        wordScore = Math.max(wordScore, SCORE_BODY);
        hasBodyHit = true;
      }

      if (wordScore > 0) {
        matchedWords += 1;
        total += wordScore;
      }
    }

    if (matchedWords > 0) {
      results.push({
        template: t,
        score: total,
        matchedWords,
        nameHits: mergeOverlapping(nameHits.sort((a, b) => a.start - b.start)),
        tagHits: [...tagHitSet],
        hasBodyHit,
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
  const out: NameHit[] = [{ ...hits[0] }];
  for (let i = 1; i < hits.length; i++) {
    const last = out[out.length - 1];
    if (hits[i].start <= last.end) {
      last.end = Math.max(last.end, hits[i].end);
    } else {
      out.push({ ...hits[i] });
    }
  }
  return out;
}

/** Split a name into segments for highlighted rendering. */
export interface NameSegment {
  text: string;
  hit: boolean;
}

export function highlightName(name: string, hits: NameHit[]): NameSegment[] {
  if (hits.length === 0) return [{ text: name, hit: false }];
  const out: NameSegment[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) out.push({ text: name.slice(cursor, h.start), hit: false });
    out.push({ text: name.slice(h.start, h.end), hit: true });
    cursor = h.end;
  }
  if (cursor < name.length) out.push({ text: name.slice(cursor), hit: false });
  return out;
}
