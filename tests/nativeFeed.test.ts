import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pcm16Base64ToFloat32,
  frameBlock,
  committedCursor,
  isCatchingUp,
  catchUpText,
  describeAudio,
  RateMeter,
  interpretCapabilities,
  FEED_FRAME,
} from "../src/lib/speech/nativeFeed.ts";

function b64(values: number[]): string {
  const buf = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => buf.writeInt16LE(v, i * 2));
  return buf.toString("base64");
}

test("pcm16Base64ToFloat32 decodes signed little-endian", () => {
  const f = pcm16Base64ToFloat32(b64([0, 16384, -16384, 32767, -32768]));
  assert.deepEqual(Array.from(f), [0, 0.5, -0.5, 32767 / 32768, -1]);
  assert.equal(pcm16Base64ToFloat32("").length, 0);
});

test("frameBlock cuts 640-sample frames with absolute positions", () => {
  const frames = frameBlock(new Float32Array(1500), 10000);
  assert.deepEqual(frames.map((f) => [f.at, f.samples.length]), [[10000, 640], [10640, 640], [11280, 220]]);
  assert.ok(frames.every((f) => f.breakAt === undefined));
  assert.equal(FEED_FRAME, 640);
});

test("frameBlock splits at breaks so the next frame starts on the break", () => {
  const frames = frameBlock(new Float32Array(1500), 0, [700]);
  assert.deepEqual(frames.map((f) => [f.at, f.samples.length, f.breakAt]), [
    [0, 640, undefined],
    [640, 60, undefined],
    [700, 640, 700],
    [1340, 160, undefined],
  ]);
  const total = frames.reduce((n, f) => n + f.samples.length, 0);
  assert.equal(total, 1500);
});

test("frameBlock: break at block start applies to the first frame; outside breaks ignored", () => {
  const frames = frameBlock(new Float32Array(700), 5000, [5000, 9999, 100]);
  assert.equal(frames[0].breakAt, 5000);
  assert.equal(frames.filter((f) => f.breakAt !== undefined).length, 1);
});

test("committedCursor is held back by open phrase and in-flight phrases", () => {
  assert.equal(committedCursor({ readPos: 1000, openStart: null, inFlightStarts: [] }), 1000);
  assert.equal(committedCursor({ readPos: 1000, openStart: 800, inFlightStarts: [] }), 800);
  assert.equal(committedCursor({ readPos: 1000, openStart: 800, inFlightStarts: [500, 900] }), 500);
  assert.equal(committedCursor({ readPos: 1000, openStart: 2000, inFlightStarts: new Set([1500]) }), 1000);
});

test("catch-up threshold and text", () => {
  assert.equal(isCatchingUp(16000 * 10, 16000 * 8), false);
  assert.equal(isCatchingUp(16000 * 10, 16000 * 5), true);
  assert.equal(catchUpText(16000 * 2), "");
  assert.equal(catchUpText(16000 * 720), "Catching up · 12 min of audio left");
  assert.equal(catchUpText(16000 * 720, 2), "Catching up · 12 min of audio left (about 6 min)");
  assert.equal(describeAudio(16000 * 45), "45 s");
});

test("RateMeter reports audio seconds per wall second", () => {
  const m = new RateMeter();
  assert.equal(m.rate(), null);
  m.add(0, 0);
  assert.equal(m.rate(), null);
  m.add(10000, 16000 * 20);
  assert.equal(m.rate(), 2);
});

test("interpretCapabilities: old APK / failure means no local capture", () => {
  assert.deepEqual(interpretCapabilities(null, true), { localCapture: false, version: 1 });
  assert.deepEqual(interpretCapabilities(undefined), { localCapture: false, version: 1 });
  const c = interpretCapabilities({ version: 2, localCapture: true, segmentSamples: 4800000, sampleRate: 16000 });
  assert.equal(c.localCapture, true);
  assert.equal(c.version, 2);
  assert.equal(interpretCapabilities({ version: 2, localCapture: "yes" }).localCapture, false);
});
