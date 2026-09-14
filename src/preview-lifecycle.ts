/** Owns preview generations and the single trailing render timer. */
export class PreviewLifecycle {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  begin(): number {
    this.cancel();
    return ++this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  schedule(generation: number, task: () => void | Promise<void>, delay = 100): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.isCurrent(generation)) void task();
    }, delay);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
