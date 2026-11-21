// Registry of open overlays so the Android back key can close the topmost first.
const overlays: Array<() => void> = [];

export function pushOverlay(close: () => void): () => void {
  overlays.push(close);
  return () => {
    const i = overlays.lastIndexOf(close);
    if (i >= 0) overlays.splice(i, 1);
  };
}

export function closeTopOverlay(): boolean {
  // Peek, don't pop: the overlay unregisters itself (via the pushOverlay
  // cleanup) once it actually closes, so it can't be left open but unregistered.
  const close = overlays[overlays.length - 1];
  if (!close) return false;
  close();
  return true;
}
