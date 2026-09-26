// Claim: resources close in reverse order of opening, and they close when the
// block ends rather than when the function returns.

import assert from "node:assert/strict";
import test from "node:test";

import { FakeDbConnection, Span, TempFolder, Trace } from "./resources.ts";

test("three await using lines close in reverse order", async () => {
  const trace = new Trace();

  {
    await using folder = await TempFolder.create(trace);
    await using db = new FakeDbConnection(trace, "db");
    await using span = new Span(trace, "seed");

    assert.equal(await db.query("select 1"), "db: select 1");
    assert.ok(await folder.exists());
    assert.equal(span.label, "seed");
    trace.add("body done");
  }

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

test("the temp folder is really gone and the connection really closed", async () => {
  const trace = new Trace();
  let folderPath = "";
  let connection: FakeDbConnection;

  {
    await using folder = await TempFolder.create(trace);
    await using db = new FakeDbConnection(trace, "db");
    folderPath = folder.path;
    connection = db;
    await folder.write("seed.sql", "insert into t values (1);\n");
    assert.ok(await folder.exists());
    assert.equal(db.open, true);
  }

  assert.equal(connection.open, false);
  await assert.rejects(() => connection.query("select 1"), /db is closed/);
  const { stat } = await import("node:fs/promises");
  await assert.rejects(() => stat(folderPath), { code: "ENOENT" });
});

test("a nested block closes its own resource before the outer one", async () => {
  const trace = new Trace();

  {
    await using outer = new FakeDbConnection(trace, "outer");
    {
      await using inner = new FakeDbConnection(trace, "inner");
      assert.equal(inner.open, true);
    }
    trace.add("between");
    assert.equal(outer.open, true);
  }

  assert.deepEqual(trace.events, [
    "open outer",
    "open inner",
    "close inner",
    "between",
    "close outer",
  ]);
});

test("null and undefined are accepted and simply skipped", async () => {
  const trace = new Trace();

  {
    await using nothing = null;
    await using alsoNothing = undefined;
    using stillNothing = null;
    await using db = new FakeDbConnection(trace, "db");
    assert.equal(nothing, null);
    assert.equal(alsoNothing, undefined);
    assert.equal(stillNothing, null);
  }

  assert.deepEqual(trace.events, ["open db", "close db"]);
});

test("a resource with no dispose method is a TypeError at the using line", () => {
  assert.throws(
    () => {
      using notDisposable = {} as Disposable;
      return notDisposable;
    },
    // V8 and the tsc downlevel helper word this differently. Both are a
    // TypeError, and both are thrown at the declaration, not at the brace.
    {
      name: "TypeError",
      message: /Symbol\(Symbol\.dispose\) is not a function|Object not disposable\./,
    },
  );
});

test("each loop iteration closes its own resource before the next one opens", async () => {
  const trace = new Trace();

  for (const shard of ["eu", "gcc"]) {
    await using db = new FakeDbConnection(trace, shard);
    assert.equal(db.open, true);
  }

  assert.deepEqual(trace.events, ["open eu", "close eu", "open gcc", "close gcc"]);
});

test("break and continue close the current iteration's resource", async () => {
  const onBreak = new Trace();
  for (const shard of ["eu", "gcc", "us"]) {
    await using db = new FakeDbConnection(onBreak, shard);
    if (shard === "gcc") break;
  }
  assert.deepEqual(onBreak.events, ["open eu", "close eu", "open gcc", "close gcc"]);

  const onContinue = new Trace();
  for (const shard of ["eu", "gcc", "us"]) {
    await using db = new FakeDbConnection(onContinue, shard);
    if (shard === "gcc") continue;
    onContinue.add(`used ${shard}`);
  }
  assert.deepEqual(onContinue.events, [
    "open eu",
    "used eu",
    "close eu",
    "open gcc",
    "close gcc",
    "open us",
    "used us",
    "close us",
  ]);
});
