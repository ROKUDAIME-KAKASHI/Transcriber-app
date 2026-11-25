import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  EnergyRing, decideWho, meCluster, newTally, tallyWho, whoForWindow,
} from "../src/lib/naming/who.ts";
import { OCR_MIN_GAP_MS, markDone, markStarted, mayRead, newGate } from "../src/lib/naming/gate.ts";
import {
  PALETTES, findActiveTile, findLargestTile, findRing, labelStrip, rgbToHsv, scaleRect, type ImgLike,
} from "../src/lib/naming/highlight.ts";
import { cleanName, matchRoster, resolveName } from "../src/lib/naming/nameClean.ts";
import {
  addRead, isUserNamed, leader, levelFor, newVotes, planMe, planName, readCounts, type AutoName, type NamingContext,
} from "../src/lib/naming/nameVote.ts";
import { formatReport, namesChanged, newStats, noteRename, parseStats, remapStats, setAuto } from "../src/lib/naming/stats.ts";
import { SCREEN_NAMING_KEY, screenNamingActive, screenNamingOptedIn, setScreenNamingOptIn } from "../src/lib/naming/optIn.ts";
import { OCR_TARGET_HEIGHT, ocrScale, prepareForOcr } from "../src/lib/naming/ocrPrep.ts";
import { FLAG_DEFAULTS } from "../src/lib/flagsCore.ts";

// ---- synthetic pictures ---------------------------------------------------------------------------------

type Img = { data: Uint8ClampedArray; width: number; height: number };
function makeImg(width: number, height: number, bg: [number, number, number]): Img {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}
function fill(img: Img, x0: number, y0: number, w: number, h: number, c: [number, number, number]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const p = (y * img.width + x) * 4;
      img.data[p] = c[0];
      img.data[p + 1] = c[1];
      img.data[p + 2] = c[2];
    }
  }
}
function stroke(img: Img, x: number, y: number, w: number, h: number, t: number, c: [number, number, number]) {
  fill(img, x, y, w, t, c);
  fill(img, x, y + h - t, w, t, c);
  fill(img, x, y, t, h, c);
  fill(img, x + w - t, y, t, h, c);
}

const BG: [number, number, number] = [32, 33, 36];
const TILE: [number, number, number] = [60, 64, 67];
const MEET_BLUE: [number, number, number] = [138, 180, 248];
const TEAMS_PURPLE: [number, number, number] = [127, 133, 245];
const ZOOM_GREEN: [number, number, number] = [60, 220, 110];

/** A 2x2 gallery of tiles on a dark page, 640x360. */
function gallery(): Img {
  const img = makeImg(640, 360, BG);
  fill(img, 20, 20, 290, 150, TILE);
  fill(img, 330, 20, 290, 150, TILE);
  fill(img, 20, 190, 290, 150, TILE);
  fill(img, 330, 190, 290, 150, TILE);
  return img;
}

describe("is it me", () => {
  test("mic loud and tab silent is me", () => assert.equal(decideWho(0.05, 0.001), "me"));
  test("tab loud is the call", () => assert.equal(decideWho(0.002, 0.04), "call"));
  test("both quiet is unknown", () => assert.equal(decideWho(0.001, 0.001), "unknown"));
  test("both loud (cross-talk) is not me", () => assert.notEqual(decideWho(0.04, 0.03), "me"));
  test("mic only a little louder than a quiet tab is unknown", () => assert.equal(decideWho(0.02, 0.01), "unknown"));
  test("echo of the call in the mic is still the call", () => assert.equal(decideWho(0.01, 0.05), "call"));
  test("bad numbers are unknown", () => assert.equal(decideWho(NaN, 0.1), "unknown"));

  test("window mean from the ring", () => {
    const ring = new EnergyRing(100);
    for (let t = 0; t < 5000; t += 100) ring.push({ at: t, mic: 0.05, tab: 0.001 });
    assert.equal(whoForWindow(ring, 5200, 3000, 400), "me");
    const empty = new EnergyRing(100);
    assert.equal(whoForWindow(empty, 5000, 2000), "unknown");
  });

  test("ring drops the oldest samples", () => {
    const ring = new EnergyRing(3);
    for (let t = 0; t < 10; t++) ring.push({ at: t, mic: 1, tab: 0 });
    assert.equal(ring.mean(0, 6), null);
    assert.equal(ring.mean(7, 9)?.n, 3);
  });

  test("a voice becomes 'me' after two clear phrases and stays one person", () => {
    const t = newTally();
    tallyWho(t, 0, "me");
    assert.equal(meCluster(t), null);
    tallyWho(t, 0, "me");
    assert.equal(meCluster(t), 0);
    tallyWho(t, 1, "me");
    tallyWho(t, 1, "me");
    tallyWho(t, 1, "me");
    assert.equal(meCluster(t), 1); // most votes wins; never two people
  });

  test("a voice that is often loud on the call is somebody else", () => {
    const t = newTally();
    tallyWho(t, 2, "me");
    tallyWho(t, 2, "me");
    for (let i = 0; i < 3; i++) tallyWho(t, 2, "call");
    assert.equal(meCluster(t), null);
  });

  test("unknown phrases change nothing", () => {
    const t = newTally();
    tallyWho(t, 0, "unknown");
    assert.equal(t.me.size + t.call.size, 0);
  });
});

describe("rate limiting", () => {
  test("one read every 3 seconds", () => {
    const g = newGate();
    assert.equal(mayRead(g, 1000, { paused: false }), true);
    markStarted(g, 1000);
    markDone(g);
    assert.equal(mayRead(g, 1000 + OCR_MIN_GAP_MS - 1, { paused: false }), false);
    assert.equal(mayRead(g, 1000 + OCR_MIN_GAP_MS, { paused: false }), true);
  });
  test("never while one is running", () => {
    const g = newGate();
    markStarted(g, 0);
    assert.equal(mayRead(g, 99999, { paused: false }), false);
    markDone(g);
    assert.equal(mayRead(g, 99999, { paused: false }), true);
  });
  test("never while paused", () => {
    assert.equal(mayRead(newGate(), 5000, { paused: true }), false);
  });
});

describe("highlight: colours", () => {
  test("palettes accept their own colour and not each other's", () => {
    const h = (c: [number, number, number]) => rgbToHsv(c[0], c[1], c[2]).h;
    assert.ok(h(MEET_BLUE) >= PALETTES.meet.hue[0] && h(MEET_BLUE) <= PALETTES.meet.hue[1]);
    assert.ok(h(TEAMS_PURPLE) >= PALETTES.teams.hue[0] && h(TEAMS_PURPLE) <= PALETTES.teams.hue[1]);
    assert.ok(h(ZOOM_GREEN) >= PALETTES.zoom.hue[0] && h(ZOOM_GREEN) <= PALETTES.zoom.hue[1]);
    assert.ok(!(h(ZOOM_GREEN) >= PALETTES.meet.hue[0] && h(ZOOM_GREEN) <= PALETTES.meet.hue[1]));
  });
});

describe("highlight: ring per platform", () => {
  for (const [name, platform, colour] of [
    ["Meet", "meet", MEET_BLUE],
    ["Teams", "teams", TEAMS_PURPLE],
    ["Zoom", "zoom", ZOOM_GREEN],
  ] as const) {
    test(`${name}: finds the ringed tile (bottom right)`, () => {
      const img = gallery();
      stroke(img, 330, 190, 290, 150, 3, colour);
      const hit = findActiveTile(img, platform);
      assert.ok(hit, "found");
      assert.equal(hit.kind, "ring");
      // The returned tile is inside the bottom-right tile.
      assert.ok(hit.rect.x >= 328 && hit.rect.x <= 340, `x ${hit.rect.x}`);
      assert.ok(hit.rect.y >= 188 && hit.rect.y <= 200, `y ${hit.rect.y}`);
      assert.ok(hit.rect.w >= 270 && hit.rect.w <= 292, `w ${hit.rect.w}`);
      assert.ok(hit.rect.h >= 130 && hit.rect.h <= 152, `h ${hit.rect.h}`);
    });
  }

  test("unknown platform tries every palette", () => {
    const img = gallery();
    stroke(img, 20, 20, 290, 150, 3, ZOOM_GREEN);
    const hit = findActiveTile(img, null);
    assert.equal(hit?.kind, "ring");
    assert.ok((hit?.rect.x ?? 0) < 40 && (hit?.rect.y ?? 0) < 40);
  });

  test("a ring with rounded (missing) corners and one broken edge piece still counts", () => {
    const img = gallery();
    stroke(img, 330, 20, 290, 150, 3, MEET_BLUE);
    for (const [cx, cy] of [[330, 20], [617, 20], [330, 167], [617, 167]]) fill(img, cx, cy, 3, 3, TILE);
    fill(img, 450, 20, 12, 3, TILE); // a small gap in the top edge
    assert.equal(findRing(img as ImgLike, PALETTES.meet) !== null, true);
  });

  test("the wrong platform's colour is not a ring for this platform", () => {
    const img = gallery();
    stroke(img, 330, 190, 290, 150, 3, ZOOM_GREEN);
    assert.equal(findRing(img, PALETTES.meet), null);
  });

  test("a thick coloured banner is not a ring", () => {
    const img = gallery();
    fill(img, 0, 0, 640, 40, MEET_BLUE);
    fill(img, 0, 200, 640, 40, MEET_BLUE);
    assert.equal(findRing(img, PALETTES.meet), null);
  });

  test("a single coloured line is not a ring", () => {
    const img = gallery();
    fill(img, 330, 190, 290, 3, MEET_BLUE);
    assert.equal(findRing(img, PALETTES.meet), null);
  });

  test("a gallery with no highlight and no big tile finds nothing", () => {
    assert.equal(findActiveTile(gallery(), "meet"), null);
  });
});

describe("highlight: speaker view fallback", () => {
  function speakerView(): Img {
    const img = makeImg(640, 360, BG);
    fill(img, 16, 16, 480, 270, TILE); // the big tile
    fill(img, 512, 16, 112, 63, TILE); // thumbnails on the right
    fill(img, 512, 95, 112, 63, TILE);
    fill(img, 512, 174, 112, 63, TILE);
    return img;
  }

  test("picks the largest tile when there is no ring", () => {
    const hit = findActiveTile(speakerView(), "teams");
    assert.equal(hit?.kind, "speaker-view");
    assert.ok(hit && hit.rect.w >= 470 && hit.rect.w <= 490, `w ${hit?.rect.w}`);
    assert.ok(hit && hit.rect.x <= 24);
  });

  test("a ring wins over the large tile", () => {
    const img = speakerView();
    stroke(img, 512, 95, 112, 63, 2, MEET_BLUE);
    const hit = findActiveTile(img, "meet");
    assert.equal(hit?.kind, "ring");
    assert.ok((hit?.rect.x ?? 0) >= 510);
  });

  test("equal tiles are not a speaker view", () => {
    assert.equal(findLargestTile(gallery()), null);
  });

  test("a tile a bit bigger than the rest is not enough", () => {
    const img = makeImg(640, 360, BG);
    fill(img, 16, 16, 300, 160, TILE);
    fill(img, 330, 16, 290, 160, TILE);
    assert.equal(findLargestTile(img), null);
  });

  test("label strip is the bottom-left of the tile", () => {
    const s = labelStrip({ x: 100, y: 50, w: 400, h: 200 });
    assert.ok(s.x > 100 && s.x < 110);
    assert.ok(s.y >= 50 + 200 * 0.8);
    assert.ok(s.y + s.h <= 250);
    assert.ok(s.w <= 400 * 0.7);
  });

  test("scaleRect scales and clamps to the frame", () => {
    assert.deepEqual(scaleRect({ x: 10, y: 10, w: 100, h: 50 }, 3, 1920, 1080), { x: 30, y: 30, w: 300, h: 150 });
    const r = scaleRect({ x: 630, y: 350, w: 50, h: 50 }, 3, 1920, 1080);
    assert.ok(r.x + r.w <= 1920 && r.y + r.h <= 1080);
  });
});

describe("name cleaning", () => {
  test("keeps a normal name", () => assert.equal(cleanName("Priya Nair")?.name, "Priya Nair"));
  test("strips (Host), (You), Presenting", () => {
    assert.equal(cleanName("Rahul Sharma (Host)")?.name, "Rahul Sharma");
    assert.equal(cleanName("Anita Rao (You)")?.name, "Anita Rao");
    assert.equal(cleanName("Anita Rao is presenting")?.name, "Anita Rao");
    assert.equal(cleanName("Sam Lee - Presenting")?.name, "Sam Lee");
    assert.equal(cleanName("Sam Lee • Guest")?.name, "Sam Lee");
  });
  test("strips mic icons and junk characters", () => {
    assert.equal(cleanName("🎤 Meera Iyer")?.name, "Meera Iyer");
    assert.equal(cleanName("Meera Iyer ▌")?.name, "Meera Iyer");
    assert.equal(cleanName("Meera Iyer 🔇")?.name, "Meera Iyer");
  });
  test("rejects device and room names", () => {
    for (const bad of ["Rahul's iPhone", "Galaxy S21", "Conference Room 4", "Boardroom", "Meeting room", "Zoom User", "Guest", "iPad"]) {
      assert.equal(cleanName(bad), null, bad);
    }
  });
  test("rejects UI text and 'You'", () => {
    for (const bad of ["You", "Mute", "Camera off", "Participants", "Recording", "Raise hand"]) assert.equal(cleanName(bad), null, bad);
  });
  test("rejects anything under two letters, and junk", () => {
    for (const bad of ["", "A", "1", "  ", "--", "i l t", "A B", "xqzk", "ee", null, undefined]) {
      assert.equal(cleanName(bad as string | null | undefined), null, String(bad));
    }
  });
  test("rejects a long sentence", () => assert.equal(cleanName("this is not a name at all really"), null));
  test("fixes digits inside words", () => assert.equal(cleanName("Anita R0y")?.name, "Anita Roy"));
  test("allows one initial", () => assert.equal(cleanName("Rahul K")?.name, "Rahul K"));
  test("accents and Devanagari survive", () => {
    assert.equal(cleanName("José Núñez")?.name, "José Núñez");
    assert.equal(cleanName("प्रिया नायर")?.name, "प्रिया नायर");
  });
  test("a cut-off label is flagged", () => {
    const c = cleanName("Priyanka Sha…");
    assert.equal(c?.truncated, true);
    assert.equal(c?.name, "Priyanka Sha");
  });
});

describe("roster matching", () => {
  const roster = ["Priya Nair", "Rahul Sharma", "Anita Rao", "Rahul Verma"];
  test("exact (any case, accents)", () => assert.equal(matchRoster("priya nair", roster)?.name, "Priya Nair"));
  test("one OCR slip", () => assert.equal(matchRoster("Priya Nalr", roster)?.name, "Priya Nair"));
  test("swapped order", () => assert.equal(matchRoster("Sharma Rahul", roster)?.name, "Rahul Sharma"));
  test("first name only when unique", () => {
    assert.equal(matchRoster("Priya", roster)?.name, "Priya Nair");
    assert.equal(matchRoster("Rahul", roster), null); // two Rahuls: refuse to guess
  });
  test("a cut-off name matches its start", () => assert.equal(matchRoster("Anita R", roster, true)?.name, "Anita Rao"));
  test("strangers do not match", () => assert.equal(matchRoster("Zoltan Kovacs", roster), null));
  test("empty roster", () => assert.equal(matchRoster("Priya Nair", []), null));

  test("resolveName cleans, matches and normalises", () => {
    assert.deepEqual(resolveName("Priya Nalr (Host)", roster), { name: "Priya Nair", roster: true });
    assert.deepEqual(resolveName("Zoltan Kovacs", roster), { name: "Zoltan Kovacs", roster: false });
    assert.equal(resolveName("Conference Room", roster), null);
  });
  test("a cut-off stranger is dropped", () => assert.equal(resolveName("Zoltan Kov…", roster), null));
});

describe("voting", () => {
  const ctx = (over: Partial<NamingContext> = {}): NamingContext => ({
    names: null, auto: new Map<number, AutoName>(), locked: new Set<number>(), ...over,
  });
  const read = (cluster: number, name: string, conf = 80, roster = false) => ({ cluster, name, conf, roster });

  test("low confidence reads do not count", () => {
    const v = newVotes();
    assert.equal(addRead(v, read(0, "Priya Nair", 30)), false);
    assert.equal(leader(v, 0), null);
    assert.equal(readCounts({ conf: 45, roster: true }), true);
    assert.equal(readCounts({ conf: 45, roster: false }), false);
  });

  test("one read of a stranger is not enough, two agreeing reads give a probable name", () => {
    const v = newVotes();
    addRead(v, read(0, "Priya Nair"));
    assert.deepEqual(planName(v, 0, ctx()), { kind: "none" });
    addRead(v, read(0, "priya nair"));
    assert.deepEqual(planName(v, 0, ctx()), { kind: "set", name: "Priya Nair", level: "probable" });
  });

  test("one read that matches an attendee is enough, as probable", () => {
    const v = newVotes();
    addRead(v, read(0, "Priya Nair", 50, true));
    assert.deepEqual(planName(v, 0, ctx()), { kind: "set", name: "Priya Nair", level: "probable" });
  });

  test("three agreeing reads confirm", () => {
    const v = newVotes();
    for (let i = 0; i < 3; i++) addRead(v, read(0, "Priya Nair"));
    assert.deepEqual(planName(v, 0, ctx()), { kind: "set", name: "Priya Nair", level: "confirmed" });
  });

  test("disagreeing reads decide nothing until one name leads", () => {
    const v = newVotes();
    addRead(v, read(0, "Priya Nair"));
    addRead(v, read(0, "Anita Rao"));
    assert.equal(levelFor(leader(v, 0)), null);
    addRead(v, read(0, "Anita Rao"));
    assert.deepEqual(planName(v, 0, ctx()), { kind: "set", name: "Anita Rao", level: "probable" }); // 2 reads and ahead of 1
  });

  test("a roster read with a competing read is not decisive", () => {
    const v = newVotes();
    addRead(v, read(0, "Priya Nair", 60, true));
    addRead(v, read(0, "Anita Rao", 60));
    assert.equal(levelFor(leader(v, 0)), null);
  });

  test("never replaces a name the user typed", () => {
    const v = newVotes();
    for (let i = 0; i < 4; i++) addRead(v, read(0, "Priya Nair"));
    assert.deepEqual(planName(v, 0, ctx({ names: { "0": "Boss" } })), { kind: "none" });
    assert.equal(isUserNamed(ctx({ names: { "0": "Boss" } }), 0), true);
  });

  test("a name we wrote ourselves is not a user name, but a changed one is", () => {
    const auto = new Map<number, AutoName>([[0, { name: "Priya Nair", level: "probable", source: "screen" }]]);
    assert.equal(isUserNamed(ctx({ names: { "0": "Priya Nair" }, auto }), 0), false);
    assert.equal(isUserNamed(ctx({ names: { "0": "Pri" }, auto }), 0), true);
  });

  test("a voice the user renamed or cleared is locked for good", () => {
    const v = newVotes();
    for (let i = 0; i < 4; i++) addRead(v, read(0, "Priya Nair"));
    assert.deepEqual(planName(v, 0, ctx({ locked: new Set([0]) })), { kind: "none" });
  });

  test("one name goes to one voice", () => {
    const v = newVotes();
    for (let i = 0; i < 3; i++) addRead(v, read(1, "Priya Nair"));
    assert.deepEqual(planName(v, 1, ctx({ names: { "0": "Priya Nair" } })), { kind: "none" });
    assert.deepEqual(planName(v, 1, ctx({ names: { "0": "Priya Nair" }, locked: new Set() })), { kind: "none" });
    assert.equal(planName(v, 1, ctx({ names: { "0": "Someone" } })).kind, "set");
  });

  test("probable becomes confirmed with the same name, and a confirmed name is not replaced", () => {
    const v = newVotes();
    const auto = new Map<number, AutoName>([[0, { name: "Priya Nair", level: "probable", source: "screen" }]]);
    for (let i = 0; i < 3; i++) addRead(v, read(0, "Priya Nair"));
    assert.deepEqual(planName(v, 0, ctx({ names: { "0": "Priya Nair" }, auto })), { kind: "set", name: "Priya Nair", level: "confirmed" });
    const v2 = newVotes();
    const confirmed = new Map<number, AutoName>([[0, { name: "Priya Nair", level: "confirmed", source: "screen" }]]);
    for (let i = 0; i < 6; i++) addRead(v2, read(0, "Anita Rao"));
    assert.deepEqual(planName(v2, 0, ctx({ names: { "0": "Priya Nair" }, auto: confirmed })), { kind: "none" });
  });

  test("a probable name can be replaced by a clear new leader", () => {
    const v = newVotes();
    const auto = new Map<number, AutoName>([[0, { name: "Priya Nair", level: "probable", source: "screen" }]]);
    for (let i = 0; i < 2; i++) addRead(v, read(0, "Anita Rao"));
    assert.deepEqual(planName(v, 0, ctx({ names: { "0": "Priya Nair" }, auto })), { kind: "set", name: "Anita Rao", level: "probable" });
  });

  test("the user's own voice: 'You' unless taken or named", () => {
    assert.deepEqual(planMe(0, "You", ctx()), { kind: "set", name: "You", level: "confirmed" });
    assert.deepEqual(planMe(0, "You", ctx({ names: { "0": "Meera" } })), { kind: "none" });
    assert.deepEqual(planMe(0, "You", ctx({ names: { "1": "You" } })), { kind: "none" });
    const auto = new Map<number, AutoName>([[0, { name: "You", level: "confirmed", source: "me" }]]);
    assert.deepEqual(planMe(0, "You", ctx({ names: { "0": "You" }, auto })), { kind: "none" });
  });

  test("a screen name never replaces the 'me' label", () => {
    const v = newVotes();
    for (let i = 0; i < 3; i++) addRead(v, read(0, "Priya Nair"));
    const auto = new Map<number, AutoName>([[0, { name: "You", level: "confirmed", source: "me" }]]);
    assert.deepEqual(planName(v, 0, ctx({ names: { "0": "You" }, auto })), { kind: "none" });
  });
});

describe("naming report", () => {
  test("counts changes and keeps the numbers", () => {
    const s = newStats("Google Meet", 0);
    s.clusters = 3;
    s.reads = 10;
    s.usable = 6;
    s.rejected = 2;
    s.noTile = 1;
    s.failed = 1;
    s.ring = 5;
    s.speakerView = 4;
    setAuto(s, { cluster: 1, name: "Priya Nair", level: "confirmed", source: "screen", reads: 3 });
    setAuto(s, { cluster: 2, name: "Anita Rao", level: "probable", source: "screen", reads: 2 });
    setAuto(s, { cluster: 0, name: "You", level: "confirmed", source: "me", reads: 0 });
    assert.equal(namesChanged(s), 0);
    assert.equal(noteRename(s, 2, "Anita R. Rao"), true);
    assert.equal(noteRename(s, 2, "Anita R. Rao"), false);
    assert.equal(noteRename(s, 9, "Nobody"), false);
    assert.equal(noteRename(s, 1, "priya nair"), false);
    assert.equal(namesChanged(s), 1);
    const text = formatReport(s);
    assert.match(text, /Call: Google Meet/);
    assert.match(text, /Voices found: 3/);
    assert.match(text, /Names read from the screen: 2 \(1 changed by you afterwards, 50% kept\)/);
    assert.match(text, /Speaker 3: Anita Rao \(probable, 2 reads\) -> you changed it to Anita R\. Rao/);
    assert.match(text, /Speaker 1: You \(microphone\)/);
    assert.match(text, /Nothing here left this device/);
  });

  test("putting the automatic name back removes the change", () => {
    const s = newStats(null, 0);
    setAuto(s, { cluster: 0, name: "Priya Nair", level: "probable", source: "screen", reads: 2 });
    noteRename(s, 0, "Pri");
    assert.equal(namesChanged(s), 1);
    noteRename(s, 0, "Priya Nair");
    assert.equal(namesChanged(s), 0);
  });

  test("entries follow the voices through the stop-time re-clustering", () => {
    const s = newStats(null, 0);
    s.clusters = 2;
    setAuto(s, { cluster: 1, name: "Priya Nair", level: "probable", source: "screen", reads: 2 });
    const live = [0, 0, 1, 1, 1];
    const final = [1, 1, 0, 0, 0];
    const r = remapStats(s, live, final);
    assert.equal(r.auto.length, 1);
    assert.equal(r.auto[0].cluster, 0);
    assert.equal(r.clusters, 2);
  });

  test("stored stats parse safely", () => {
    assert.equal(parseStats(null), null);
    assert.equal(parseStats({ v: 2 }), null);
    const s = newStats("Zoom", 5);
    setAuto(s, { cluster: 0, name: "A B", level: "probable", source: "screen", reads: 2 });
    assert.deepEqual(parseStats(JSON.parse(JSON.stringify(s))), s);
  });
});

describe("opt-in and gating", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  test("off by default, on and off again", () => {
    const s = store();
    assert.equal(screenNamingOptedIn(s), false);
    setScreenNamingOptIn(s, true);
    assert.equal(s.getItem(SCREEN_NAMING_KEY), "1");
    assert.equal(screenNamingOptedIn(s), true);
    setScreenNamingOptIn(s, false);
    assert.equal(screenNamingOptedIn(s), false);
  });
  test("a blocked store is off", () => {
    assert.equal(screenNamingOptedIn(null), false);
    const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    assert.equal(screenNamingOptedIn(bad), false);
    assert.doesNotThrow(() => setScreenNamingOptIn(bad, true));
  });
  test("runs only when every condition holds", () => {
    const all = { flag: true, optIn: true, guided: true, desktopChromium: true };
    assert.equal(screenNamingActive(all), true);
    for (const k of Object.keys(all) as Array<keyof typeof all>) assert.equal(screenNamingActive({ ...all, [k]: false }), false, k);
  });
  test("the feature switch defaults on like every flag", () => assert.equal(FLAG_DEFAULTS.screenNaming, true));
});

describe("OCR preparation", () => {
  test("light text on a dark label is inverted to dark on light", () => {
    const img = makeImg(20, 8, [20, 20, 20]);
    fill(img, 4, 2, 10, 4, [240, 240, 240]);
    const r = prepareForOcr(img);
    assert.equal(r.inverted, true);
    assert.ok(img.data[0] > 200); // background became light
    assert.ok(img.data[(3 * 20 + 8) * 4] < 60); // text became dark
  });
  test("dark text on light is left dark on light", () => {
    const img = makeImg(20, 8, [240, 240, 240]);
    fill(img, 4, 2, 10, 4, [10, 10, 10]);
    assert.equal(prepareForOcr(img).inverted, false);
    assert.ok(img.data[0] > 200);
  });
  test("scale brings small labels up to a readable height", () => {
    assert.equal(ocrScale(OCR_TARGET_HEIGHT), 1);
    assert.equal(ocrScale(36), 2);
    assert.equal(ocrScale(5), 4);
    assert.equal(ocrScale(500), 1);
    assert.equal(ocrScale(0), 1);
  });
});
