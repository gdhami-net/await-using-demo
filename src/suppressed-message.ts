// Prints the SuppressedError a failed cleanup produces, as JSON. check.mjs runs
// this file twice — once as TypeScript straight on Node, once after tsc has
// compiled it to a target below esnext — because the two paths do not produce
// the same `message` string.

import { BrokenConnection } from "./resources.ts";

async function main(): Promise<void> {
  try {
    await using broken = new BrokenConnection("db");
    throw new Error("seed script failed on row 4");
  } catch (error) {
    const suppressed = error as SuppressedError;
    process.stdout.write(
      JSON.stringify({
        name: suppressed.name,
        message: suppressed.message,
        error: (suppressed.error as Error).message,
        suppressed: (suppressed.suppressed as Error).message,
      }) + "\n",
    );
  }
}

await main();
