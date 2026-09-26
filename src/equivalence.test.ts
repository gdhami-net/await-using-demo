// Claim: the three `await using` lines do what the three nested try/finally
// blocks did, on the happy path and on the failing one.

import assert from "node:assert/strict";
import test from "node:test";

import { Trace } from "./resources.ts";
import { seedWithTryFinally, seedWithUsing } from "./seed.ts";

const CLEAN = [
  "create temp folder",
  "open db",
  "begin seed",
  "body done",
  "end seed",
  "close db",
  "remove temp folder",
];

const FAILED = [
  "create temp folder",
  "open db",
  "begin seed",
  "end seed",
  "close db",
  "remove temp folder",
];

test("both versions produce the same trace when nothing fails", async () => {
  const a = new Trace();
  const b = new Trace();

  await seedWithUsing(a, false);
  await seedWithTryFinally(b, false);

  assert.deepEqual(a.events, CLEAN);
  assert.deepEqual(b.events, CLEAN);
});

test("both versions produce the same trace when the body throws", async () => {
  const a = new Trace();
  const b = new Trace();

  await assert.rejects(() => seedWithUsing(a, true), /seed script failed on row 4/);
  await assert.rejects(() => seedWithTryFinally(b, true), /seed script failed on row 4/);

  assert.deepEqual(a.events, FAILED);
  assert.deepEqual(b.events, FAILED);
});
