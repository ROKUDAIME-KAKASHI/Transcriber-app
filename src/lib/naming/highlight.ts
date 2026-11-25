// Finds the tile that the call platform has highlighted as "speaking", on a downscaled frame of the shared
// tab. Pure and DOM-free: it works on ImageData-shaped objects ({ data, width, height }, RGBA) so node tests
// can feed synthetic pictures. Erasable TypeScript only, no imports.
//
// NOTE: the colour palettes below are best-effort descriptions of each platform's ring, NOT measured on real
// calls yet. Phase 23's UAT (23-HUMAN-UAT.md) is where they get checked; they are plain data, easy to tune.

export interface ImgLike {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PlatformId = "meet" | "teams" | "zoom";

export interface Palette {
  /** Hue range in degrees [from, to], inclusive (from <= to). */
  hue: [number, number];
  minSat: number;
  minVal: number;
}

export const PALETTES: Record<PlatformId, Palette> = {
  // Meet: a blue outline around the speaking tile.
  meet: { hue: [200, 228], minSat: 0.3, minVal: 0.55 },
  // Teams: a purple / violet outline.
  teams: { hue: [232, 265], minSat: 0.28, minVal: 0.45 },
  // Zoom (web client): a green / yellow-green frame.
  zoom: { hue: [80, 150], minSat: 0.45, minVal: 0.55 },
};

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rf) h = ((gf - bf) / d) % 6;
    else if (max === gf) h = (bf - rf) / d + 2;
    else h = (rf - gf) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function inPalette(p: Palette, r: number, g: number, b: number): boolean {
  const { h, s, v } = rgbToHsv(r, g, b);
  return s >= p.minSat && v >= p.minVal && h >= p.hue[0] && h <= p.hue[1];
}

/** 1 where the pixel has the platform's highlight colour. */
export function highlightMask(img: ImgLike, palette: Palette): Uint8Array {
  const { width: W, height: H, data } = img;
  const m = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    if (data[p + 3] < 128) continue;
    if (inPalette(palette, data[p], data[p + 1], data[p + 2])) m[i] = 1;
  }
  return m;
}

interface Bar {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Long thin horizontal runs of mask pixels (rows grouped into bars of limited thickness). */
function horizontalBars(mask: Uint8Array, W: number, H: number): Bar[] {
  const minRun = Math.max(8, Math.round(W * 0.08));
  const maxThick = Math.max(3, Math.round(H * 0.025));
  // A small break (a hover button, a rounded corner) does not split an edge.
  const maxGap = Math.max(1, Math.round(W * 0.025));
  let open: Bar[] = [];
  const done: Bar[] = [];
  for (let y = 0; y < H; y++) {
    const runs: Array<[number, number]> = [];
    let start = -1;
    let gap = 0;
    for (let x = 0; x <= W; x++) {
      const on = x < W && mask[y * W + x] === 1;
      if (on) {
        if (start < 0) start = x;
        gap = 0;
      } else if (start >= 0) {
        gap++;
        if (gap > maxGap || x === W) {
          const end = x - gap;
          if (end - start + 1 >= minRun) runs.push([start, end]);
          start = -1;
          gap = 0;
        }
      }
    }
    const next: Bar[] = [];
    for (const [a, b] of runs) {
      const hit = open.find((bar) => Math.min(bar.x1, b) - Math.max(bar.x0, a) + 1 >= 0.6 * Math.min(bar.x1 - bar.x0 + 1, b - a + 1));
      if (hit) {
        hit.x0 = Math.min(hit.x0, a);
        hit.x1 = Math.max(hit.x1, b);
        hit.y1 = y;
        next.push(hit);
        open = open.filter((o) => o !== hit);
      } else {
        next.push({ x0: a, x1: b, y0: y, y1: y });
      }
    }
    for (const o of open) done.push(o);
    open = next;
  }
  for (const o of open) done.push(o);
  return done.filter((b) => b.y1 - b.y0 + 1 <= maxThick);
}

function hasMaskIn(mask: Uint8Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) if (mask[y * W + x]) return true;
  }
  return false;
}

export interface RingHit {
  /** The tile inside the ring. */
  rect: Rect;
  /** 0..1, how much of the rectangle's outline is highlight-coloured. */
  coverage: number;
}

/** A rectangle outline drawn in the palette's colour: the active-speaker ring. */
export function findRing(img: ImgLike, palette: Palette): RingHit | null {
  const { width: W, height: H } = img;
  if (W < 40 || H < 30) return null;
  const mask = highlightMask(img, palette);
  const bars = horizontalBars(mask, W, H);
  const tol = Math.max(3, Math.round(W * 0.03));
  const minTileH = Math.max(12, Math.round(H * 0.1));
  let best: { hit: RingHit; area: number } | null = null;
  for (const top of bars) {
    for (const bot of bars) {
      if (bot.y0 - top.y1 < minTileH) continue;
      if (Math.abs(top.x0 - bot.x0) > tol || Math.abs(top.x1 - bot.x1) > tol) continue;
      const x0 = Math.min(top.x0, bot.x0);
      const x1 = Math.max(top.x1, bot.x1);
      const y0 = top.y0;
      const y1 = bot.y1;
      const t = Math.max(1, Math.max(top.y1 - top.y0, bot.y1 - bot.y0) + 1);
      const side = (n: number, probe: (i: number) => boolean) => {
        let c = 0;
        for (let i = 0; i < n; i++) if (probe(i)) c++;
        return n ? c / n : 0;
      };
      const wLen = x1 - x0 + 1;
      const hLen = y1 - y0 + 1;
      const r = t + 2; // how far an edge may sit from the bar's corner (rounded corners cut the bars short)
      const topCov = side(wLen, (i) => hasMaskIn(mask, W, H, x0 + i, y0 - 1, x0 + i, y0 + t));
      const botCov = side(wLen, (i) => hasMaskIn(mask, W, H, x0 + i, y1 - t, x0 + i, y1 + 1));
      const leftCov = side(hLen, (i) => hasMaskIn(mask, W, H, x0 - r, y0 + i, x0 + t, y0 + i));
      const rightCov = side(hLen, (i) => hasMaskIn(mask, W, H, x1 - t, y0 + i, x1 + r, y0 + i));
      const cov = (topCov + botCov + leftCov + rightCov) / 4;
      if (cov < 0.8 || Math.min(topCov, botCov, leftCov, rightCov) < 0.6) continue;
      const inner: Rect = { x: x0 + t, y: y0 + t, w: Math.max(1, wLen - 2 * t), h: Math.max(1, hLen - 2 * t) };
      const area = wLen * hLen;
      if (!best || cov > best.hit.coverage + 0.05 || (Math.abs(cov - best.hit.coverage) <= 0.05 && area > best.area)) {
        best = { hit: { rect: inner, coverage: cov }, area };
      }
    }
  }
  return best ? best.hit : null;
}

// ---- Speaker view: the one big tile ---------------------------------------------------------------------

const CELL = 8;

function quant(v: number): number {
  return v >> 4;
}

/** The page background: the most common colour (4 bits per channel) along the frame's outer edge. */
function backgroundColour(img: ImgLike): [number, number, number] {
  const { width: W, height: H, data } = img;
  const counts = new Map<number, number>();
  const edge = Math.max(1, Math.round(Math.min(W, H) * 0.02));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!(y < edge || y >= H - edge || x < edge || x >= W - edge)) continue;
      const p = (y * W + x) * 4;
      const k = (quant(data[p]) << 8) | (quant(data[p + 1]) << 4) | quant(data[p + 2]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  let bestK = 0;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestK = k;
      bestN = n;
    }
  }
  return [((bestK >> 8) & 15) * 16 + 8, ((bestK >> 4) & 15) * 16 + 8, (bestK & 15) * 16 + 8];
}

export interface TileHit {
  rect: Rect;
  /** Area of the biggest tile divided by the second biggest (Infinity when there is only one). */
  dominance: number;
}

/**
 * The biggest tile, found as the biggest rectangular blob of "not background" 8 px cells. In a gallery of
 * equal tiles nothing stands out, so it only answers when the biggest tile is clearly bigger than the next.
 */
export function findLargestTile(img: ImgLike, minDominance = 1.8): TileHit | null {
  const { width: W, height: H, data } = img;
  if (W < 40 || H < 30) return null;
  const bg = backgroundColour(img);
  const cw = Math.floor(W / CELL);
  const ch = Math.floor(H / CELL);
  const content = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let diff = 0;
      let n = 0;
      for (let y = cy * CELL; y < cy * CELL + CELL; y += 2) {
        for (let x = cx * CELL; x < cx * CELL + CELL; x += 2) {
          const p = (y * W + x) * 4;
          const d = Math.max(Math.abs(data[p] - bg[0]), Math.abs(data[p + 1] - bg[1]), Math.abs(data[p + 2] - bg[2]));
          if (d > 20) diff++;
          n++;
        }
      }
      if (diff / n >= 0.5) content[cy * cw + cx] = 1;
    }
  }
  const seen = new Uint8Array(cw * ch);
  const blobs: Array<{ x0: number; y0: number; x1: number; y1: number; cells: number }> = [];
  for (let i = 0; i < cw * ch; i++) {
    if (!content[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    const b = { x0: cw, y0: ch, x1: -1, y1: -1, cells: 0 };
    while (stack.length) {
      const c = stack.pop() as number;
      const cx = c % cw;
      const cy = (c - cx) / cw;
      b.cells++;
      if (cx < b.x0) b.x0 = cx;
      if (cx > b.x1) b.x1 = cx;
      if (cy < b.y0) b.y0 = cy;
      if (cy > b.y1) b.y1 = cy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const ni = ny * cw + nx;
        if (content[ni] && !seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    blobs.push(b);
  }
  // Only rectangular blobs count as tiles (a filled bounding box), and tiny ones are ignored.
  const tiles = blobs
    .map((b) => ({ ...b, area: (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) }))
    .filter((b) => b.cells / b.area >= 0.7 && b.area >= cw * ch * 0.02)
    .sort((a, b) => b.area - a.area);
  if (!tiles.length) return null;
  const top = tiles[0];
  if (top.area < cw * ch * 0.08) return null;
  const dominance = tiles.length > 1 ? top.area / tiles[1].area : Infinity;
  if (dominance < minDominance) return null;
  return {
    rect: { x: top.x0 * CELL, y: top.y0 * CELL, w: (top.x1 - top.x0 + 1) * CELL, h: (top.y1 - top.y0 + 1) * CELL },
    dominance,
  };
}

// ---- Putting it together --------------------------------------------------------------------------------

export type TileKind = "ring" | "speaker-view";

export interface ActiveTile {
  rect: Rect;
  kind: TileKind;
}

/** The palettes to try: the known platform's, or all of them when the platform is not known. */
export function palettesFor(platform: PlatformId | null | undefined): Palette[] {
  return platform ? [PALETTES[platform]] : [PALETTES.meet, PALETTES.teams, PALETTES.zoom];
}

/** The speaking tile: the highlight ring when one is found, else the big tile of a speaker view, else null. */
export function findActiveTile(img: ImgLike, platform?: PlatformId | null): ActiveTile | null {
  let best: RingHit | null = null;
  for (const p of palettesFor(platform)) {
    const r = findRing(img, p);
    if (r && (!best || r.coverage > best.coverage)) best = r;
  }
  if (best) return { rect: best.rect, kind: "ring" };
  const big = findLargestTile(img);
  return big ? { rect: big.rect, kind: "speaker-view" } : null;
}

/** Where a tile's name label sits: its bottom-left corner (all three platforms), in the tile's own units. */
export function labelStrip(tile: Rect): Rect {
  return { x: tile.x + tile.w * 0.01, y: tile.y + tile.h * 0.84, w: tile.w * 0.6, h: tile.h * 0.15 };
}

/** Scales a rectangle (e.g. from the small analysis frame to the full-size frame), clamped to the frame. */
export function scaleRect(r: Rect, factor: number, maxW: number, maxH: number): Rect {
  const x = Math.max(0, Math.floor(r.x * factor));
  const y = Math.max(0, Math.floor(r.y * factor));
  const w = Math.max(1, Math.min(maxW - x, Math.ceil(r.w * factor)));
  const h = Math.max(1, Math.min(maxH - y, Math.ceil(r.h * factor)));
  return { x, y, w, h };
}
