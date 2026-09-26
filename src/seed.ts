// The same seeding helper written twice. Nothing in either version is
// simplified for the post: equivalence.test.ts runs both and compares the
// traces they produce, with and without a failure.

import { FakeDbConnection, Span, TempFolder, Trace } from "./resources.ts";

export async function seedWithUsing(trace: Trace, fail: boolean): Promise<void> {
  await using folder = await TempFolder.create(trace);
  await using db = new FakeDbConnection(trace, "db");
  await using span = new Span(trace, "seed");

  await folder.write("seed.sql", "insert into t values (1);\n");
  if (fail) throw new Error("seed script failed on row 4");
  trace.add("body done");
}

export async function seedWithTryFinally(trace: Trace, fail: boolean): Promise<void> {
  const folder = await TempFolder.create(trace);
  try {
    const db = new FakeDbConnection(trace, "db");
    try {
      const span = new Span(trace, "seed");
      try {
        await folder.write("seed.sql", "insert into t values (1);\n");
        if (fail) throw new Error("seed script failed on row 4");
        trace.add("body done");
      } finally {
        span[Symbol.dispose]();
      }
    } finally {
      await db[Symbol.asyncDispose]();
    }
  } finally {
    await folder[Symbol.asyncDispose]();
  }
}
