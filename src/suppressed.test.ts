// Claim: when the body throws and a cleanup throws too, the caller gets a
// SuppressedError whose `error` is the cleanup failure and whose `suppressed`
// is the original. The field names are the part people get backwards.

import assert from "node:assert/strict";
import test from "node:test";

import { BrokenConnection, FakeDbConnection, Trace } from "./resources.ts";

function asSuppressed(error: unknown): SuppressedError {
  assert.ok(error instanceof SuppressedError, `expected SuppressedError, got ${String(error)}`);
  return error;
}

test("body error plus cleanup error becomes one SuppressedError", async () => {
  const caught = await captured(async () => {
    await using broken = new BrokenConnection("db");
    throw new Error("seed script failed on row 4");
  });

  const suppressed = asSuppressed(caught);
  assert.equal(suppressed.name, "SuppressedError");
  assert.equal((suppressed.error as Error).message, "could not close db");
  assert.equal((suppressed.suppressed as Error).message, "seed script failed on row 4");
  assert.ok(suppressed instanceof Error);
});

test("a cleanup failure on its own propagates unwrapped", async () => {
  const caught = await captured(async () => {
    await using broken = new BrokenConnection("db");
  });

  assert.ok(caught instanceof Error);
  assert.ok(!(caught instanceof SuppressedError));
  assert.equal((caught as Error).message, "could not close db");
});

test("two failing cleanups nest, newest error outermost", async () => {
  const caught = await captured(async () => {
    await using first = new BrokenConnection("first");
    await using second = new BrokenConnection("second");
  });

  // `second` is closed first, so its failure is the one that gets suppressed
  // by `first`'s failure.
  const outer = asSuppressed(caught);
  assert.equal((outer.error as Error).message, "could not close first");
  assert.equal((outer.suppressed as Error).message, "could not close second");
});

test("three failing cleanups nest one level deeper", async () => {
  const caught = await captured(async () => {
    await using a = new BrokenConnection("a");
    await using b = new BrokenConnection("b");
    await using c = new BrokenConnection("c");
  });

  const outer = asSuppressed(caught);
  assert.equal((outer.error as Error).message, "could not close a");
  const inner = asSuppressed(outer.suppressed);
  assert.equal((inner.error as Error).message, "could not close b");
  assert.equal((inner.suppressed as Error).message, "could not close c");
});

test("a healthy resource still closes when a later cleanup fails", async () => {
  const trace = new Trace();

  const caught = await captured(async () => {
    await using good = new FakeDbConnection(trace, "good");
    await using broken = new BrokenConnection("broken");
  });

  assert.equal((caught as Error).message, "could not close broken");
  assert.deepEqual(trace.events, ["open good", "close good"]);
});

async function captured(body: () => Promise<void>): Promise<unknown> {
  try {
    await body();
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: "expected the block to throw, it did not" });
}
