import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceChunker } from "../src/lib/speech/voiceChunker.ts";
import { frameBlock } from "../src/lib/speech/nativeFeed.ts";

const SR = 16000;

/** Deterministic noise-like tone: amplitude `amp`. */
function tone(samples: number, amp: number, offset = 0): Float32Array {
  const a = new Float32Array(samples);
  for (let i = 0; i < samples; i++) a[i] = amp * Math.sin(2 * Math.PI * 300 * ((i + offset) / SR)) * (1 + 0.3 * Math.sin(i * 0.37));
  return a;
}
function cat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const quiet = (s: number) => tone(s, 0.0005);
const loud = (s: number) => tone(s, 0.2);

function run(audio: Float32Array, startAt: number, breaks: number[] = [], extra?: (c: VoiceChunker) => void) {
  const out: Array<{ len: number; id: number; startSec: number }> = [];
  const c = VoiceChunker.forFeed({ onSegment: (a, id, startSec) => out.push({ len: a.length, id, startSec }) }, startAt);
  for (const f of frameBlock(audio, startAt, breaks)) {
    if (f.breakAt !== undefined) c.breakAt(f.breakAt);
    c.feed(f.samples);
  }
  extra?.(c);
  return { out, c };
}

test("feed mode cuts a phrase and stamps it with the absolute clock", () => {
  const start = 16000 * 600; // resumed at 10 min
  const audio = cat(quiet(SR * 2), loud(SR * 2), quiet(SR * 2));
  const { out } = run(audio, start);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].startSec - (600 + 2)) < 0.2, `startSec ${out[0].startSec}`);
});

test("feed mode is chunk-size independent for the phrase count", () => {
  const audio = cat(quiet(SR * 2), loud(SR * 2), quiet(SR * 2), loud(SR * 2), quiet(SR * 2));
  assert.equal(run(audio, 0).out.length, 2);
});

test("a pause break splits a phrase and moves the clock", () => {
  const audio = cat(quiet(SR), loud(SR * 2), loud(SR * 2), quiet(SR * 2));
  const breakAt = SR * 3;
  const { out } = run(audio, 0, [breakAt]);
  assert.equal(out.length, 2);
  assert.ok(Math.abs(out[1].startSec - 3) < 0.2, `second phrase starts ${out[1].startSec}`);
});

test("openStart is the open phrase start, else the clock", () => {
  const { c } = run(cat(quiet(SR), loud(SR)), 0);
  assert.ok(c.openStart() < SR * 1.1);
  assert.ok(c.openStart() >= SR * 0.6, `openStart ${c.openStart()}`);
  const idle = VoiceChunker.forFeed({ onSegment: () => {} }, 5000);
  assert.equal(idle.openStart(), 5000);
});

test("onSegment reports the first sample including the preroll (holds the committed cursor back)", () => {
  const first: number[] = [];
  const c = VoiceChunker.forFeed({ onSegment: (_a, _id, startSec, firstSample) => first.push(Math.round(startSec * SR) - firstSample) }, 1000);
  for (const f of frameBlock(cat(quiet(SR * 2), loud(SR * 2), quiet(SR * 2)), 1000)) c.feed(f.samples);
  assert.equal(first.length, 1);
  // The phrase begins with up to 300 ms of preroll before the first voiced frame.
  assert.ok(first[0] >= 0 && first[0] <= 0.35 * SR, `preroll samples ${first[0]}`);
});
