import {
  rankTemplates,
  explainRankError,
  type Ranking,
} from "$lib/api";
import { type ModelTier, type PasteBackend, type Template } from "$lib/types";

const RANK_DEBOUNCE_MS = 600;

/** Owns the paste-match (AI re-rank) feature: the debounced rank call plus its
 *  loading/error/result state. Lives here rather than in +page.svelte so the
 *  orchestrator only wires a thin effect to `schedule` / `clear`.
 *
 *  Staleness model: a fast typist must never see results for a query they've
 *  already moved past. Every scheduled/retried call records its query string in
 *  `#latestQuery`; results are only applied when that query is still the latest
 *  one requested. (The previous +page implementation expressed this as
 *  `searchQuery === q` against the live reactive value — same guard, just
 *  tracked internally now.) */
class PasteMatchStore {
  rankings = $state<Ranking[] | null>(null);
  rankLoading = $state(false);
  rankError = $state<string | null>(null);

  // The most recently requested query. Compared against the captured `q` of an
  // in-flight call so stale responses are discarded.
  #latestQuery: string | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  /** Debounced re-rank for the active search query. Cancels any pending timer,
   *  then after RANK_DEBOUNCE_MS fires the rank call. Results / errors / the
   *  loading flag are only applied while `query` remains the latest request. */
  schedule(query: string, catalog: Template[], backend: PasteBackend, model: ModelTier): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#latestQuery = query;
    this.#timer = setTimeout(async () => {
      this.rankLoading = true;
      this.rankError = null;
      try {
        const result = await rankTemplates(query, catalog, backend, model);
        if (this.#latestQuery === query) this.rankings = result;
      } catch (e) {
        if (this.#latestQuery === query) {
          this.rankError = explainRankError(String(e));
          this.rankings = null;
        }
      } finally {
        if (this.#latestQuery === query) this.rankLoading = false;
      }
    }, RANK_DEBOUNCE_MS);
  }

  /** Immediate re-rank (no debounce) for a manual Retry. Same staleness guard:
   *  a search change that lands mid-flight discards this result. */
  async retry(query: string, catalog: Template[], backend: PasteBackend, model: ModelTier): Promise<void> {
    this.rankError = null;
    this.#latestQuery = query;
    this.rankLoading = true;
    try {
      const result = await rankTemplates(query, catalog, backend, model);
      if (this.#latestQuery === query) this.rankings = result;
    } catch (e) {
      if (this.#latestQuery === query) this.rankError = explainRankError(String(e));
    } finally {
      if (this.#latestQuery === query) this.rankLoading = false;
    }
  }

  /** Reset to the idle state and cancel any pending debounce. Called when the
   *  query drops below the paste threshold. */
  clear(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#latestQuery = null;
    this.rankings = null;
    this.rankError = null;
    this.rankLoading = false;
  }
}

export const pasteMatchStore = new PasteMatchStore();
