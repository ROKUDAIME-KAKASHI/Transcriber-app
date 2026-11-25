"use client";

// Grabs single pictures from the shared tab's video track, on demand. Nothing is recorded or stored: a frame
// lives only until it has been analysed, then it is dropped.

import { scaleRect, labelStrip, type ImgLike, type Rect } from "./highlight";
import { OCR_TARGET_HEIGHT, ocrScale, prepareForOcr } from "./ocrPrep";

/** The frame is analysed at this width (nearest-neighbour, so a thin ring keeps its exact colour). */
export const ANALYSIS_WIDTH = 640;

type ImageCaptureLike = { grabFrame(): Promise<ImageBitmap> };
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

export class FrameSource {
  private track: MediaStreamTrack;
  private capture: ImageCaptureLike | null = null;
  private video: HTMLVideoElement | null = null;
  private disposed = false;

  constructor(track: MediaStreamTrack) {
    this.track = track;
    this.setup();
  }

  private setup() {
    const Ctor = (globalThis as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
    if (Ctor) {
      try {
        this.capture = new Ctor(this.track);
        return;
      } catch {
        this.capture = null;
      }
    }
    // Fallback: a hidden <video> fed by the track.
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.srcObject = new MediaStream([this.track]);
    void v.play().catch(() => {});
    this.video = v;
  }

  /** Swap to the track of a new share ("Share again"). */
  setTrack(track: MediaStreamTrack) {
    this.release();
    this.track = track;
    this.disposed = false;
    this.setup();
  }

  /** One frame of the shared tab, or null when none is available right now. */
  async grab(): Promise<ImageBitmap | null> {
    if (this.disposed || this.track.readyState !== "live") return null;
    try {
      if (this.capture) return await this.capture.grabFrame();
      const v = this.video;
      if (v && v.videoWidth > 0 && v.videoHeight > 0) return await createImageBitmap(v);
    } catch {
      /* a frame can fail while the tab is hidden or the share is changing */
    }
    return null;
  }

  private release() {
    this.disposed = true;
    this.capture = null;
    if (this.video) {
      try {
        this.video.pause();
        this.video.srcObject = null;
      } catch {
        /* nothing to release */
      }
      this.video = null;
    }
  }

  dispose() {
    this.release();
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  return c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
}

/** The frame as a small RGBA picture for tile finding, with the factor back to full size. */
export function analysisImage(bitmap: ImageBitmap): { img: ImgLike; factor: number } | null {
  const factor = bitmap.width > ANALYSIS_WIDTH ? bitmap.width / ANALYSIS_WIDTH : 1;
  const w = Math.max(1, Math.round(bitmap.width / factor));
  const h = Math.max(1, Math.round(bitmap.height / factor));
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  if (!g) return null;
  g.imageSmoothingEnabled = false;
  g.drawImage(bitmap, 0, 0, w, h);
  const id = g.getImageData(0, 0, w, h);
  return { img: { data: id.data, width: id.width, height: id.height }, factor };
}

/** The tile's label strip at full resolution, prepared for OCR, as a PNG. */
export async function labelBlob(bitmap: ImageBitmap, tile: Rect, factor: number): Promise<Blob | null> {
  const strip = scaleRect(labelStrip(tile), factor, bitmap.width, bitmap.height);
  const s = ocrScale(strip.h);
  const w = Math.max(1, Math.round(strip.w * s));
  const h = Math.max(1, Math.min(Math.round(strip.h * s), OCR_TARGET_HEIGHT * 4));
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  if (!g) return null;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(bitmap, strip.x, strip.y, strip.w, strip.h, 0, 0, w, h);
  const id = g.getImageData(0, 0, w, h);
  prepareForOcr(id);
  g.putImageData(id, 0, 0);
  if ("convertToBlob" in c) return (c as OffscreenCanvas).convertToBlob({ type: "image/png" });
  return new Promise((resolve) => (c as HTMLCanvasElement).toBlob((b) => resolve(b), "image/png"));
}
