"use client";

/**
 * Splits live microphone audio into speech phrases for Moonshine.
 *
 * Moonshine v1 transcribes whole clips rather than streaming, so:
 *  - phrases are cut at natural pauses (simple energy-based voice detection) and sent as
 *    16 kHz mono clips for the final transcript;
 *  - while a phrase is still being spoken, `peek()` returns the audio so far, which the
 *    recorder re-transcribes every fraction of a second to show words live.
 */
import { Resampler } from "./resampler";

// A phrase ends at a pause. Short fragments ("So, um") are poor input on their own: the model
// lacks context and tends to mishear or drop them, so a phrase under SHORT_PHRASE_MS waits for a
// longer pause and usually joins up with what comes next.
const SILENCE_TO_END_MS = 650;
const SHORT_PHRASE_MS = 1500;
const SILENCE_TO_END_SHORT_MS = 1100;
// Keep at most this much trailing silence: enough for the last word to finish, without long
// quiet tails that waste compute and invite the model to invent words.
const TRAILING_SILENCE_MS = 350;
const MAX_SEGMENT_MS = 15000; // long monologues are split so live previews stay cheap on phones
const CUT_SEARCH_MS = 1500; // when splitting, look this far back for the quietest moment
const MIN_SPEECH_MS = 300; // ignore coughs and clicks
const PREROLL_MS = 300; // keep a little audio before speech starts so first syllables aren't clipped

// Speech detection. Quiet laptop/Windows mics can deliver speech at RMS ≈ 0.002–0.01, so the
// threshold is relative to the measured background noise, with only a very low absolute floor.
// (A fixed 0.01 floor missed speech entirely at ~3% input volume.)
const MIN_THRESHOLD = 0.0006;
const NOISE_MULTIPLIER = 2.5;
// Background noise = the quietest moment in a rolling window. Tracking it continuously (also
// while someone talks) lets the gaps between phrases register as pauses in hissy rooms.
const NOISE_WINDOW_MS = 3000;
// Quiet phrases are boosted toward this peak before transcription (max 20×), which helps the model.
const TARGET_PEAK = 0.9;
const MAX_BOOST = 20;

// Buffers ~2048 samples in the audio thread before posting, to keep message traffic low.
const WORKLET_SRC = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const chans = inputs[0];
    const ch = chans && chans[0];
    if (ch) {
      const k = chans.length; // some phones deliver a stereo mic: mix down instead of dropping a side
      for (let i = 0; i < ch.length; i++) {
        let v = ch[i];
        if (k > 1) { for (let c = 1; c < k; c++) v += chans[c][i]; v /= k; }
        this.buf[this.n++] = v;
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor("moonshine-tap", Tap);
`;

/** `samples` are already filtered and resampled to 16 kHz. */
type Frame = { samples: Float32Array; rms: number; voiced: boolean; /** start, in 16 kHz samples of recorded (unpaused) audio */ at: number };

function concat(frames: Frame[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.samples.length, 0));
  let o = 0;
  for (const f of frames) { out.set(f.samples, o); o += f.samples.length; }
  return out;
}

/** Boosts quiet audio toward TARGET_PEAK (in place). Loud audio is left alone. */
function normalize(audio: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < audio.length; i++) peak = Math.max(peak, Math.abs(audio[i]));
  if (peak <= 0 || peak >= TARGET_PEAK) return audio;
  const gain = Math.min(MAX_BOOST, TARGET_PEAK / peak);
  for (let i = 0; i < audio.length; i++) audio[i] *= gain;
  return audio;
}

export interface VoiceChunkerEvents {
  /** A finished phrase. `phraseId` matches the ids `peek()` returned while it was being spoken. */
  onSegment: (audio16k: Float32Array, phraseId: number, startSec: number) => void;
  onSpeechChange?: (speaking: boolean) => void;
  /** Mic loudness for a level meter: RMS of the latest frame and the current speech threshold. */
  onLevel?: (rms: number, threshold: number) => void;
  /** Every frame of filtered 16 kHz audio while not paused (used to stream to Deepgram). */
  onAudio?: (samples16k: Float32Array) => void;
}

export class VoiceChunker {
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;

  private preroll: Frame[] = [];
  private segment: Frame[] = [];
  private inSpeech = false;
  private silenceMs = 0;
  private speechMs = 0;
  private rmsHistory: number[] = [];
  private frameMs = 0;
  private phraseId = 0;
  /** 16 kHz samples heard so far, excluding pauses: the clock for phrase timestamps. */
  private heard = 0;
  private paused = false;
  private peekedLength = 0;
  private resampler: Resampler;

  constructor(private ctx: AudioContext, private events: VoiceChunkerEvents) {
    this.resampler = new Resampler(ctx.sampleRate);
  }

  async start(stream: MediaStream) {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    // On iOS a resume() without a fresh tap can stay pending forever, which used to hang "Starting…".
    // Don't wait on it for long: the recorder's watchdog warns if audio never starts flowing.
    if (this.ctx.state !== "running") {
      await Promise.race([this.ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    }

    this.source = this.ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.ctx, "moonshine-tap");
    // Muted path to the speakers: browsers only pull audio through nodes connected to the output.
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node).connect(this.sink).connect(this.ctx.destination);
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onFrame(e.data);
  }

  /**
   * The phrase being spoken right now, as 16 kHz audio, for a live preview.
   * Returns null when nobody is talking, or nothing new has been heard since the last peek.
   */
  peek(): { audio: Float32Array; phraseId: number } | null {
    if (!this.inSpeech || this.speechMs < MIN_SPEECH_MS) return null;
    if (this.segment.length === this.peekedLength) return null;
    this.peekedLength = this.segment.length;
    return { audio: normalize(concat(this.segment)), phraseId: this.phraseId };
  }

  private onFrame(raw: Float32Array) {
    this.frameMs = (raw.length / this.ctx.sampleRate) * 1000;
    if (this.paused) return;
    const samples = this.resampler.process(raw);
    if (samples.length === 0) return;
    this.events.onAudio?.(samples);
    const at = this.heard;
    this.heard += samples.length;
    // Loudness is measured after filtering, so hum and DC offset don't count as speech.
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    this.rmsHistory.push(rms);
    const maxHistory = Math.max(1, Math.round(NOISE_WINDOW_MS / this.frameMs));
    if (this.rmsHistory.length > maxHistory) this.rmsHistory.shift();
    const noiseFloor = Math.min(...this.rmsHistory);
    const threshold = Math.max(MIN_THRESHOLD, noiseFloor * NOISE_MULTIPLIER);
    const voiced = rms > threshold;
    const frame: Frame = { samples, rms, voiced, at };
    this.events.onLevel?.(rms, threshold);

    if (!this.inSpeech) {
      this.preroll.push(frame);
      while (this.preroll.length * this.frameMs > PREROLL_MS && this.preroll.length > 1) this.preroll.shift();
      if (voiced) {
        this.inSpeech = true;
        this.phraseId += 1;
        this.segment = this.preroll;
        this.preroll = [];
        this.silenceMs = 0;
        this.speechMs = this.frameMs;
        this.peekedLength = 0;
        this.events.onSpeechChange?.(true);
      }
      return;
    }

    this.segment.push(frame);
    if (voiced) {
      this.speechMs += this.frameMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += this.frameMs;
    }

    const endAfter = this.speechMs < SHORT_PHRASE_MS ? SILENCE_TO_END_SHORT_MS : SILENCE_TO_END_MS;
    if (this.silenceMs >= endAfter) {
      this.emit(this.segment);
      this.segment = [];
      this.inSpeech = false;
      this.events.onSpeechChange?.(false);
    } else if (this.segment.length * this.frameMs >= MAX_SEGMENT_MS) {
      this.splitLongPhrase();
    }
  }

  /** Cut a long monologue at its quietest recent moment, so words aren't chopped in half. */
  private splitLongPhrase() {
    const searchFrames = Math.max(1, Math.round(CUT_SEARCH_MS / this.frameMs));
    let cut = this.segment.length - 1;
    for (let i = this.segment.length - 1; i >= Math.max(1, this.segment.length - searchFrames); i--) {
      if (this.segment[i].rms < this.segment[cut].rms) cut = i;
    }
    const head = this.segment.slice(0, cut + 1);
    const tail = this.segment.slice(cut + 1);
    this.emit(head);
    // Carry on in the same speech turn with a new phrase id.
    this.phraseId += 1;
    this.segment = tail;
    this.speechMs = tail.filter((f) => f.voiced).length * this.frameMs;
    this.peekedLength = 0;
  }

  private emit(frames: Frame[]) {
    const voicedMs = frames.filter((f) => f.voiced).length * this.frameMs;
    this.silenceMs = 0;
    if (voicedMs < MIN_SPEECH_MS || frames.length === 0) return;
    // Trim the trailing pause down to TRAILING_SILENCE_MS.
    let end = frames.length;
    while (end > 0 && !frames[end - 1].voiced) end--;
    end = Math.min(frames.length, end + Math.round(TRAILING_SILENCE_MS / this.frameMs));
    // Timestamp = where the speech starts, after the pre-roll.
    const firstVoiced = frames.find((f) => f.voiced) ?? frames[0];
    this.events.onSegment(normalize(concat(frames.slice(0, end))), this.phraseId, firstVoiced.at / 16000);
  }

  /** Sends whatever is mid-phrase (used when recording stops). */
  /** Pause: finish the current phrase and ignore audio until resume(). The mic stays open. */
  pause() {
    this.flush();
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.preroll = []; // don't stitch pre-pause audio onto the next phrase
  }

  flush() {
    if (this.inSpeech) this.emit(this.segment);
    this.segment = [];
    this.inSpeech = false;
    this.events.onSpeechChange?.(false);
  }

  stop() {
    this.flush();
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    this.node = this.source = this.sink = null;
  }
}
