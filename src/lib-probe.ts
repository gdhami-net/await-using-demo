// The smallest file that needs the disposable declarations and nothing else.
// It compiles under tsconfig.json and must NOT compile under
// tsconfig.no-disposable-lib.json — that pair is what proves the `lib` entry
// is load-bearing rather than decorative.

export class Probe implements Disposable {
  disposed = false;

  [Symbol.dispose](): void {
    this.disposed = true;
  }
}

export function useProbe(): boolean {
  using probe = new Probe();
  return probe.disposed;
}
