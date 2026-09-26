// Claim: cleanup runs when the block ends by throwing, in the same reverse
// order, and the original error is what the caller sees.

import assert from "node:assert/strict";
import test from "node:test";

import { FakeDbConnection, Span, Trace } from "./resources.ts";
import { seedWithUsing } from "./seed.ts";

test("everything still closes when the body throws", async () => {
  const trace = new Trace();

  await assert.rejects(() => seedWithUsing(trace, true), /seed script failed on row 4/);

  assert.deepEqual(trace.events, [
    "create temp folder",
    "open db",
    "begin seed",
    "end seed",
    "close db",
    "remove temp folder",
  ]);
});

test("the same code with no error closes in the same order", async () => {
  const trace = new Trace();

  await seedWithUsing(trace, false);

  assert.deepEqual(trace.events, [
    "create temp folder",
    "open db",
    "begin seed",
    "body done",
    "end seed",
    "close db",
    "remove temp folder",
  ]);
});

test("an early return closes everything too", async () => {
  const trace = new Trace();

  async function bail(): Promise<string> {
    await using db = new FakeDbConnection(trace, "db");
    await using span = new Span(trace, "work");
    return "early";
  }

  assert.equal(await bail(), "early");
  assert.deepEqual(trace.events, ["open db", "begin work", "end work", "close db"]);
});

test("a resource never reached is never closed", async () => {
  const trace = new Trace();

  function boom(): void {
    throw new Error("stop here");
  }

  async function halfway(): Promise<void> {
    await using first = new FakeDbConnection(trace, "first");
    boom();
    await using second = new FakeDbConnection(trace, "second");
    assert.ok(second.open);
  }

  await assert.rejects(() => halfway(), /stop here/);
  assert.deepEqual(trace.events, ["open first", "close first"]);
});
