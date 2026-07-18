/** Registers the active compose preview's copy handler (Enter / toolbar). */
class ComposeSession {
  #copyHandler: (() => void | Promise<void>) | null = null;

  /** Register the live preview's copy function. Returns unregister. */
  registerCopyHandler(handler: () => void | Promise<void>): () => void {
    this.#copyHandler = handler;
    return () => {
      if (this.#copyHandler === handler) this.#copyHandler = null;
    };
  }

  /** Invoke the registered copy handler, if any. */
  requestCopy(): void {
    void this.#copyHandler?.();
  }
}

export const composeSession = new ComposeSession();
