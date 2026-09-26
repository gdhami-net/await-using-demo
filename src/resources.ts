// The three resources the post talks about. Nothing here is clever: each one
// just records what it did in a shared Trace so a test can assert the order.

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Every open and close, in the order it actually happened. */
export class Trace {
  readonly events: string[] = [];

  add(event: string): void {
    this.events.push(event);
  }
}

/**
 * Stands in for a test database connection: no network, but the same
 * open-then-close shape, and it refuses to answer once it is closed.
 */
export class FakeDbConnection implements AsyncDisposable {
  readonly name: string;
  #trace: Trace;
  #open = true;

  constructor(trace: Trace, name: string) {
    this.#trace = trace;
    this.name = name;
    trace.add(`open ${name}`);
  }

  get open(): boolean {
    return this.#open;
  }

  async query(sql: string): Promise<string> {
    if (!this.#open) throw new Error(`${this.name} is closed`);
    return `${this.name}: ${sql}`;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#open = false;
    this.#trace.add(`close ${this.name}`);
  }
}

/**
 * A real directory under the OS temp folder. The whole tree goes away when the
 * block that declared it ends.
 */
export class TempFolder implements AsyncDisposable {
  readonly path: string;
  #trace: Trace;

  private constructor(trace: Trace, path: string) {
    this.#trace = trace;
    this.path = path;
  }

  static async create(trace: Trace, prefix = "await-using-"): Promise<TempFolder> {
    const path = await mkdtemp(join(tmpdir(), prefix));
    trace.add("create temp folder");
    return new TempFolder(trace, path);
  }

  async write(name: string, body: string): Promise<string> {
    const file = join(this.path, name);
    await writeFile(file, body, "utf8");
    return file;
  }

  async exists(): Promise<boolean> {
    try {
      await stat(this.path);
      return true;
    } catch {
      return false;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await rm(this.path, { recursive: true, force: true });
    this.#trace.add("remove temp folder");
  }
}

/**
 * Synchronous on purpose: `await using` accepts a plain Disposable, which is
 * how a timer or a log scope ends up in the same list as the async ones.
 */
export class Span implements Disposable {
  readonly label: string;
  #trace: Trace;

  constructor(trace: Trace, label: string) {
    this.#trace = trace;
    this.label = label;
    trace.add(`begin ${label}`);
  }

  [Symbol.dispose](): void {
    this.#trace.add(`end ${this.label}`);
  }
}

/** A resource whose cleanup fails. Used for the SuppressedError tests. */
export class BrokenConnection implements AsyncDisposable {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    throw new Error(`could not close ${this.name}`);
  }
}
