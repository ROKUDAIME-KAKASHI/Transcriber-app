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
  const close = overlays.pop();
  if (!close) return false;
  close();
  return true;
}
