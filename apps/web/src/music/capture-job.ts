/** Shared lifetime for listen/play, live challenge and uploaded assessment. */
export type CaptureHandle = {release: () => void};
export type CaptureStart = {generation: number; signal: AbortSignal};

export function createCaptureJob() {
  let generation = 0;
  let controller: AbortController | null = null;
  let handles: CaptureHandle[] = [];

  const releaseHandles = () => {
    const current = handles; handles = [];
    for (const handle of current.reverse()) {
      try { handle.release(); } catch { /* cancellation is best effort */ }
    }
  };
  const cancel = () => {
    const active = controller !== null || handles.length > 0;
    generation += 1;
    controller?.abort(); controller = null;
    releaseHandles();
    return active;
  };

  return {
    begin(): CaptureStart {
      cancel();
      generation += 1;
      controller = new AbortController();
      return {generation, signal: controller.signal};
    },
    isCurrent(token: number): boolean { return token === generation; },
    register(handle: CaptureHandle): void {
      if (controller === null) { handle.release(); return; }
      handles.push(handle);
    },
    /** Null means a stale generation; the caller must discard the result. */
    settle<T>(token: number, value: T): T | null {
      if (token !== generation) return null;
      controller = null;
      releaseHandles();
      return value;
    },
    cancel,
    get active(): boolean { return controller !== null; },
    get generation(): number { return generation; },
  };
}
