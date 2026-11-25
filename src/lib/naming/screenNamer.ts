"use client";

// Reads the speaker's name off the shared call tab and attaches it to the right voice (Phase 23).
// Lazy-loaded by the recorder only for a guided tab recording with the flag on and the device opted in.
// Everything runs on this device: frames are analysed in memory and dropped, only name strings are kept.
//
// The recorder feeds it:  classify() when a phrase ends (mic vs tab loudness), noteSpeech() when that phrase
// is assigned to a voice, setPaused(), userRenamed(). The namer calls back with setAutoName() / onState().

import { FrameSource, analysisImage, labelBlob } from "./frames";
import { findActiveTile, type PlatformId } from "./highlight";
import { markDone, markStarted, mayRead, newGate } from "./gate";
import { resolveWithRosters } from "./nameClean";
import {
  addRead, isUserNamed, leader, newVotes, planMe, planName, type AutoName, type Level, type NamingContext,
} from "./nameVote";
import type { NameReader, NameReaderFactory } from "./reader";
import { newStats, noteRename, setAuto, type NamingStats } from "./stats";
import { EnergyRing, meCluster, newTally, tallyWho, whoForWindow, type Who } from "./who";

export const SAMPLE_EVERY_MS = 150;
/** A phrase assigned to a voice more than this long after it ended is too old to match the screen. */
export const MAX_STALE_MS = 6000;
export const ME_LABEL = "You";

export type NamerStatus = "loading" | "on" | "unavailable";

export interface NamerState {
  status: NamerStatus;
  /** A frame is being read right now. */
  reading: boolean;
  /** Names this feature has set, by voice number (as a string). */
  auto: Record<string, { name: string; level: Level; source: "screen" | "me" }>;
}

export interface NamerHost {
  /** The meeting's current speaker names (including the user's own). */
  getNames(): Record<string, string> | null;
  /** Writes a name for a voice (the host stores and shows it). */
  setAutoName(cluster: number, name: string): void;
  onState(s: NamerState): void;
}

export interface NamerOptions {
  track: MediaStreamTrack;
  platform: PlatformId | null;
  /** People expected in this meeting (the plan's attendees). */
  attendees: string[];
  /** The People directory (names only). */
  directory: string[];
  host: NamerHost;
  /** Loudness sources: the microphone, and the call tab (a getter, because "Share again" replaces it). */
  micAnalyser: AnalyserNode | null;
  getTabAnalyser: () => AnalyserNode | null;
  loadReader: NameReaderFactory;
  now?: () => number;
}

export interface PhraseInfo {
  who: Who;
  /** When the phrase ended (the namer's clock, see classify()). */
  endedAt: number;
}

export class ScreenNamer {
  private readonly o: NamerOptions;
  private readonly now: () => number;
  private frames: FrameSource;
  private reader: NameReader | null = null;
  private status: NamerStatus = "loading";
  private reading = false;
  private paused = false;
  private disposed = false;
  private readonly ring = new EnergyRing(480);
  private readonly tally = newTally();
  private readonly votes = newVotes();
  private readonly gate = newGate();
  private readonly auto = new Map<number, AutoName>();
  private readonly locked = new Set<number>();
  private readonly stats: NamingStats;
  private sampler: ReturnType<typeof setInterval> | null = null;
  private micBuf: Float32Array<ArrayBuffer> | null = null;
  private tabBuf: Float32Array<ArrayBuffer> | null = null;
  private mine: number | null = null;
  private newest: { cluster: number; endedAt: number } | null = null;

  constructor(o: NamerOptions) {
    this.o = o;
    this.now = o.now ?? (() => performance.now());
    this.frames = new FrameSource(o.track);
    this.stats = newStats(o.platform === "meet" ? "Google Meet" : o.platform === "teams" ? "Microsoft Teams" : o.platform === "zoom" ? "Zoom (browser)" : null, Date.now());
  }

  /** Loads the OCR engine (lazily) and starts sampling loudness. Resolves false when OCR cannot run here. */
  async start(): Promise<boolean> {
    this.startSampling();
    this.emit();
    try {
      const r = await this.o.loadReader();
      if (this.disposed) {
        void r.dispose();
        return false;
      }
      this.reader = r;
      this.status = "on";
    } catch {
      this.status = "unavailable";
      this.stopSampling();
    }
    this.emit();
    return this.status === "on";
  }

  private startSampling() {
    const rms = (an: AnalyserNode | null, which: "mic" | "tab"): number => {
      if (!an) return 0;
      const size = an.fftSize;
      let buf = which === "mic" ? this.micBuf : this.tabBuf;
      if (!buf || buf.length !== size) {
        buf = new Float32Array(size);
        if (which === "mic") this.micBuf = buf;
        else this.tabBuf = buf;
      }
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.sqrt(sum / buf.length);
    };
    this.sampler = setInterval(() => {
      if (this.paused || this.disposed) return;
      this.ring.push({ at: this.now(), mic: rms(this.o.micAnalyser, "mic"), tab: rms(this.o.getTabAnalyser(), "tab") });
    }, SAMPLE_EVERY_MS);
  }

  private stopSampling() {
    if (this.sampler) clearInterval(this.sampler);
    this.sampler = null;
  }

  /** Call when a phrase has just ended: who was loud (the user's mic, or the call)? */
  classify(durSec: number): PhraseInfo {
    const t = this.now();
    return { who: whoForWindow(this.ring, t, durSec * 1000), endedAt: t - 600 };
  }

  setPaused(p: boolean) {
    this.paused = p;
  }

  /** "Share again": a new share replaces the old video track. */
  swapTrack(track: MediaStreamTrack) {
    this.frames.setTrack(track);
  }

  /** The recorder assigned a finished phrase to a voice. */
  noteSpeech(cluster: number, info: PhraseInfo) {
    if (this.disposed) return;
    tallyWho(this.tally, cluster, info.who);
    if (!this.newest || info.endedAt >= this.newest.endedAt) this.newest = { cluster, endedAt: info.endedAt };
    // 1. Is this voice the user? Then it is named "You" and never read from the screen.
    const me = meCluster(this.tally);
    if (me !== null && me !== this.mine) {
      this.mine = me;
      this.applyMe(me);
    }
    if (cluster === this.mine) return;
    // 2. A call-side phrase from a voice with no confirmed name: read the screen.
    if (info.who !== "call") return;
    if (this.status !== "on" || this.paused) return;
    if (this.now() - info.endedAt > MAX_STALE_MS) return;
    // A newer phrase already belongs to another voice: the highlight has probably moved on.
    if (this.newest && this.newest.cluster !== cluster && this.newest.endedAt > info.endedAt) return;
    const ctx = this.context();
    if (isUserNamed(ctx, cluster)) return;
    if (this.auto.get(cluster)?.level === "confirmed") return;
    if (!mayRead(this.gate, this.now(), { paused: this.paused })) return;
    void this.readOnce(cluster);
  }

  private context(): NamingContext {
    return { names: this.o.host.getNames(), auto: this.auto, locked: this.locked };
  }

  private applyMe(cluster: number) {
    const plan = planMe(cluster, ME_LABEL, this.context());
    if (plan.kind !== "set") return;
    this.commit(cluster, { name: plan.name, level: plan.level, source: "me" }, 0);
  }

  private commit(cluster: number, a: AutoName, reads: number) {
    this.auto.set(cluster, a);
    setAuto(this.stats, { cluster, name: a.name, level: a.level, source: a.source, reads });
    this.o.host.setAutoName(cluster, a.name);
    this.emit();
  }

  private async readOnce(cluster: number) {
    const reader = this.reader;
    if (!reader) return;
    markStarted(this.gate, this.now());
    this.reading = true;
    this.emit();
    this.stats.reads += 1;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await this.frames.grab();
      if (!bitmap) {
        this.stats.failed += 1;
        return;
      }
      const small = analysisImage(bitmap);
      if (!small) {
        this.stats.failed += 1;
        return;
      }
      const tile = findActiveTile(small.img, this.o.platform);
      if (!tile) {
        this.stats.noTile += 1;
        return;
      }
      if (tile.kind === "ring") this.stats.ring += 1;
      else this.stats.speakerView += 1;
      const blob = await labelBlob(bitmap, tile.rect, small.factor);
      if (!blob) {
        this.stats.failed += 1;
        return;
      }
      const read = await reader.read(blob);
      if (this.disposed) return;
      const resolved = read ? resolveWithRosters(read.text, this.o.attendees, this.o.directory) : null;
      if (!read || !resolved) {
        this.stats.rejected += 1;
        return;
      }
      const counted = addRead(this.votes, { cluster, name: resolved.name, conf: read.confidence, roster: resolved.roster });
      if (!counted) {
        this.stats.rejected += 1;
        return;
      }
      this.stats.usable += 1;
      const plan = planName(this.votes, cluster, this.context());
      if (plan.kind === "set") this.commit(cluster, { name: plan.name, level: plan.level, source: "screen" }, leader(this.votes, cluster)?.reads ?? 1);
    } catch {
      this.stats.failed += 1;
    } finally {
      try {
        bitmap?.close();
      } catch {
        /* already released */
      }
      markDone(this.gate);
      this.reading = false;
      if (!this.disposed) this.emit();
    }
  }

  /** The user typed (or cleared) a name for a voice: that voice is theirs from now on. */
  userRenamed(cluster: number, name: string) {
    const auto = this.auto.get(cluster);
    this.locked.add(cluster);
    if (auto) {
      noteRename(this.stats, cluster, name);
      if (name.trim() && name.trim() !== auto.name) this.auto.delete(cluster);
      else if (!name.trim()) this.auto.delete(cluster);
    }
    this.emit();
  }

  /** A copy of the statistics so far. */
  snapshot(): NamingStats {
    return JSON.parse(JSON.stringify(this.stats)) as NamingStats;
  }

  private emit() {
    if (this.disposed) return;
    const auto: NamerState["auto"] = {};
    for (const [k, v] of this.auto) auto[String(k)] = { ...v };
    this.o.host.onState({ status: this.status, reading: this.reading, auto });
  }

  /** Stops sampling, frees the OCR worker and drops every frame. Safe to call twice. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopSampling();
    this.frames.dispose();
    const r = this.reader;
    this.reader = null;
    if (r) void r.dispose();
    this.ring.clear();
  }
}
