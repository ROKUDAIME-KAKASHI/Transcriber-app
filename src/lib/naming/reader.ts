// The seam between "find the name label picture" and "turn a picture into text". Anything that can read a
// small picture of a name label can be plugged in (Tesseract today; a small vision model such as Cactus
// "Mirage" if a browser build ever exists). Types only, so it costs nothing to import.

export interface NameRead {
  /** Raw text as the engine read it (cleaning and matching happen later). */
  text: string;
  /** Engine confidence, 0..100. */
  confidence: number;
}

export interface NameReader {
  /** Short engine name, for the report ("tesseract"). */
  readonly id: string;
  /** Reads one cropped, prepared label picture. Null when nothing could be read. */
  read(image: Blob): Promise<NameRead | null>;
  /** Frees the engine (stops its worker). Safe to call twice. */
  dispose(): Promise<void>;
}

/** Loads an engine. Rejects when it cannot run here (missing files, no SIMD, blocked worker). */
export type NameReaderFactory = () => Promise<NameReader>;
