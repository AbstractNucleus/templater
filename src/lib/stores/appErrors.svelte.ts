/** App-level error banners. Load failures stay distinct from action failures
 *  so popouts/dialogs don't import templatesStore just to set a string. */
class AppErrors {
  /** Bootstrap / disk load failures (and corrupt-settings lock messaging). */
  loadError = $state<string | null>(null);
  /** Save, export, popout, open-folder, and other post-load actions. */
  actionError = $state<string | null>(null);

  /** Prefer load over action when both are set. */
  get banner(): string | null {
    return this.loadError ?? this.actionError;
  }

  setLoad(message: string): void {
    this.loadError = message;
  }

  setAction(message: string): void {
    this.actionError = message;
  }

  clearLoad(): void {
    this.loadError = null;
  }

  clearAction(): void {
    this.actionError = null;
  }

  /** Dismiss whichever message is currently shown in the banner. */
  dismiss(): void {
    if (this.loadError !== null) this.loadError = null;
    else this.actionError = null;
  }
}

export const appErrors = new AppErrors();
