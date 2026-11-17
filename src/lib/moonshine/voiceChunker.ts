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
const TARGET_RATE = 16000;
const SILENCE_TO_END_MS = 700; // pause length that ends a phrase
const MAX_SEGMENT_MS = 15000; // long monologues are split so live previews stay cheap on phones
const CUT_SEARCH_MS = 1500; // when splitting, look this far back for the quietest moment
const MIN_SPEECH_MS = 300; // ignore coughs and clicks
const PREROLL_MS = 300; // keep a little audio before speech starts so first syllables aren't clipped

// Buffers ~2048 samples in the audio thread before posting, to keep message traffic low.
const WORKLET_SRC = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor("moonshine-tap", Tap);
`;

type Frame = { samples: Float32Array; rms: number; voiced: boolean };

function resample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_RATE) return input;
  const ratio = fromRate / TARGET_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
  }
  return out;
}

function concat(frames: Frame[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.samples.length, 0));
  let o = 0;
  for (const f of frames) { out.set(f.samples, o); o += f.samples.length; }
  return out;
}

export interface VoiceChunkerEvents {
  /** A finished phrase. `phraseId` matches the ids `peek()` returned while it was being spoken. */
  onSegment: (audio16k: Float32Array, phraseId: number) => void;
  onSpeechChange?: (speaking: boolean) => void;
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
  private noiseFloor = 0.005;
  private frameMs = 0;
  private phraseId = 0;
  private peekedLength = 0;

  constructor(private ctx: AudioContext, private events: VoiceChunkerEvents) {}

  async start(stream: MediaStream) {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();

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
    return { audio: resample(concat(this.segment), this.ctx.sampleRate), phraseId: this.phraseId };
  }

  private onFrame(samples: Float32Array) {
    this.frameMs = (samples.length / this.ctx.sampleRate) * 1000;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    const voiced = rms > Math.max(0.01, this.noiseFloor * 3);
    const frame: Frame = { samples, rms, voiced };

    if (!this.inSpeech) {
      // Track background noise only while nobody is talking.
      this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
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

    if (this.silenceMs >= SILENCE_TO_END_MS) {
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
    this.events.onSegment(resample(concat(frames), this.ctx.sampleRate), this.phraseId);
  }

  /** Sends whatever is mid-phrase (used when recording stops). */
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
