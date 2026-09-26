// Claim: AsyncDisposableStack covers the case a `using` line cannot — a number
// of resources only known at run time — and disposes them in the same reverse
// order.

import assert from "node:assert/strict";
import test from "node:test";

import { FakeDbConnection, Trace } from "./resources.ts";

test("a stack closes a run-time number of connections in reverse order", async () => {
  const trace = new Trace();
  const shards = ["eu", "gcc", "us"];

  {
    await using stack = new AsyncDisposableStack();
    const connections = shards.map((shard) =>
      stack.use(new FakeDbConnection(trace, shard)),
    );

    assert.equal(connections.length, 3);
    assert.equal(await connections[0]!.query("select 1"), "eu: select 1");
    trace.add("body done");
  }

  assert.deepEqual(trace.events, [
    "open eu",
    "open gcc",
    "open us",
    "body done",
    "close us",
    "close gcc",
    "close eu",
  ]);
});

test("defer and adopt land in the same reverse order as use", async () => {
  const trace = new Trace();

  {
    await using stack = new AsyncDisposableStack();
    stack.use(new FakeDbConnection(trace, "db"));
    stack.defer(async () => trace.add("deferred callback"));
    stack.adopt({ handle: 7 }, (value) => trace.add(`adopted ${value.handle}`));
  }

  assert.deepEqual(trace.events, [
    "open db",
    "adopted 7",
    "deferred callback",
    "close db",
  ]);
});

test("the stack closes on a throw as well, and reports disposed afterwards", async () => {
  const trace = new Trace();
  let seen: AsyncDisposableStack | undefined;

  async function build(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    seen = stack;
    stack.use(new FakeDbConnection(trace, "db"));
    assert.equal(stack.disposed, false);
    throw new Error("migration failed");
  }

  await assert.rejects(() => build(), /migration failed/);
  assert.deepEqual(trace.events, ["open db", "close db"]);
  assert.equal(seen?.disposed, true);
});

test("move hands ownership to the caller so a failed build closes nothing twice", async () => {
  const trace = new Trace();

  async function openPool(): Promise<AsyncDisposableStack> {
    await using stack = new AsyncDisposableStack();
    stack.use(new FakeDbConnection(trace, "primary"));
    stack.use(new FakeDbConnection(trace, "replica"));
    // If anything above had thrown, the stack would have closed both on the
    // way out. It did not, so ownership moves to the caller and this scope's
    // own disposal has nothing left to do.
    return stack.move();
  }

  {
    await using pool = await openPool();
    assert.equal(pool.disposed, false);
    trace.add("using the pool");
  }

  assert.deepEqual(trace.events, [
    "open primary",
    "open replica",
    "using the pool",
    "close replica",
    "close primary",
  ]);
});

test("a sync DisposableStack works the same way", () => {
  const order: string[] = [];

  {
    using stack = new DisposableStack();
    stack.defer(() => order.push("first"));
    stack.defer(() => order.push("second"));
  }

  assert.deepEqual(order, ["second", "first"]);
});
