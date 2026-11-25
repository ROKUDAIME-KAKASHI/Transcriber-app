import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CreateBody, ImportBody, PatchBody, MAX_IMPORT, buildSuggestions, canAddNew, findPossibleDuplicate, groupAlphabetically,
  groupLetter, matchesQuery, pickerOptions, personLine, type Person,
} from "../src/lib/stakeholders.ts";

const P = (id: string, name: string, extra: Partial<Person> = {}): Person => ({
  id, name, designation: null, organisation: null, area: null, email: null, phone: null, notes: null, ...extra,
});

describe("validation", () => {
  test("trims, lowercases email, blanks become null", () => {
    const r = CreateBody.parse({ name: "  Asha Rao ", email: " Asha@Example.COM ", designation: "  ", area: "Finance" });
    assert.equal(r.name, "Asha Rao");
    assert.equal(r.email, "asha@example.com");
    assert.equal(r.designation, null);
    assert.equal(r.area, "Finance");
  });
  test("name required, bad email rejected, caps enforced", () => {
    assert.equal(CreateBody.safeParse({ name: "  " }).success, false);
    assert.equal(CreateBody.safeParse({ name: "A", email: "nope" }).success, false);
    assert.equal(CreateBody.safeParse({ name: "A".repeat(101) }).success, false);
    assert.equal(CreateBody.safeParse({ name: "A", notes: "x".repeat(2001) }).success, false);
    assert.equal(CreateBody.safeParse({ name: "A", email: "" }).success, true);
  });
  test("patch needs at least one field", () => {
    assert.equal(PatchBody.safeParse({}).success, false);
    assert.equal(PatchBody.safeParse({ area: "Ops" }).success, true);
  });
  test("import is capped at 200", () => {
    const mk = (n: number) => ({ people: Array.from({ length: n }, (_, i) => ({ name: `P${i}` })) });
    assert.equal(ImportBody.safeParse(mk(MAX_IMPORT)).success, true);
    assert.equal(ImportBody.safeParse(mk(MAX_IMPORT + 1)).success, false);
    assert.equal(ImportBody.safeParse({ people: [] }).success, false);
  });
});

describe("duplicates", () => {
  const list = [P("1", "Asha Rao", { email: "Asha@x.com" }), P("2", "Vikram Shah")];
  test("same email, any case", () => {
    const d = findPossibleDuplicate({ name: "Someone Else", email: "ASHA@x.com" }, list);
    assert.equal(d?.person.id, "1");
    assert.equal(d?.reason, "email");
  });
  test("similar name", () => {
    assert.equal(findPossibleDuplicate({ name: "asha  rao" }, list)?.reason, "name");
    assert.equal(findPossibleDuplicate({ name: "Asha" }, list), null);
  });
  test("ignores itself when editing", () => {
    assert.equal(findPossibleDuplicate({ name: "Asha Rao", email: "asha@x.com" }, list, "1"), null);
  });
  test("empty name never matches", () => assert.equal(findPossibleDuplicate({ name: "   " }, list), null));
});

describe("search and grouping", () => {
  const a = P("1", "Asha Rao", { designation: "CFO", organisation: "Acme", area: "Finance", email: "asha@acme.com" });
  test("matches across fields", () => {
    for (const q of ["asha", "cfo", "ACME", "finance", "@acme", ""]) assert.ok(matchesQuery(a, q), q);
    assert.ok(!matchesQuery(a, "legal"));
  });
  test("groups alphabetically with # last", () => {
    const g = groupAlphabetically([P("1", "zed"), P("2", "123 Corp"), P("3", "Ámbar"), P("4", "alok")]);
    assert.deepEqual(g.map((x) => x.letter), ["A", "Z", "#"]);
    assert.deepEqual(g[0].people.map((p) => p.name), ["alok", "Ámbar"]);
  });
  test("groupLetter handles Devanagari and blanks", () => {
    assert.equal(groupLetter("आशा"), "आ".normalize("NFKD")[0]);
    assert.equal(groupLetter(""), "#");
  });
  test("personLine", () => {
    assert.equal(personLine({ designation: "CFO", organisation: "Acme" }), "CFO · Acme");
    assert.equal(personLine({ designation: null, organisation: "Acme" }), "Acme");
    assert.equal(personLine({ designation: null, organisation: null }), "");
  });
});

describe("picker", () => {
  const people = [P("1", "Rohan Mehta"), P("2", "Meera Iyer", { designation: "Head of Ops" }), P("3", "Mehul Shah")];
  test("prefix matches first, limit applies", () => {
    assert.deepEqual(pickerOptions(people, "me").map((p) => p.name), ["Meera Iyer", "Mehul Shah", "Rohan Mehta"]);
    assert.equal(pickerOptions(people, "", 2).length, 2);
  });
  test("designation is searchable", () => assert.deepEqual(pickerOptions(people, "ops").map((p) => p.id), ["2"]));
  test("canAddNew hides for exact names and blanks", () => {
    assert.equal(canAddNew("meera iyer", people), false);
    assert.equal(canAddNew("Meera", people), true);
    assert.equal(canAddNew("  ", people), false);
  });
});

describe("suggestions", () => {
  const existing = [{ id: "1", name: "Asha Rao", email: "asha@x.com" }];
  test("drops people already in the directory and placeholders, dedupes, keeps email", () => {
    const s = buildSuggestions(existing, {
      owners: ["asha rao", "Vikram", "vikram", "Speaker 2"],
      speakers: ["Meera", "Vikram"],
      bookings: [{ name: "Guest Name", email: "Guest@Y.com" }, { name: "Asha R", email: "ASHA@x.com" }],
    });
    assert.deepEqual(s.map((x) => x.name), ["Guest Name", "Meera", "Vikram"]);
    assert.equal(s[0].email, "guest@y.com");
    assert.equal(s[2].source, "speaker");
  });
  test("respects the limit", () => {
    const owners = Array.from({ length: 30 }, (_, i) => `Person${i}x`);
    assert.equal(buildSuggestions([], { owners }, 5).length, 5);
  });
});
