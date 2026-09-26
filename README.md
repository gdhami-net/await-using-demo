# await-using-demo

Companion repo for the post **"Deterministic cleanup in TypeScript with `await
using` and `DisposableStack`"** ([gdhami.net](https://gdhami.net) — link added
when the post is live).

A test database connection and a real temp folder, closed by the block that
opened them, with the closing order and the error handling asserted instead of
described.

## What it proves

```bash
npm install
npm run check
```

```
node v26.1.0  ·  Version 5.9.3

PASS  Node 26.1.0 has Symbol.dispose, Symbol.asyncDispose, DisposableStack, AsyncDisposableStack, SuppressedError
PASS  src typechecks under strict, target ES2022, lib ES2022 + ESNext.Disposable
PASS  without ESNext.Disposable in lib, the same file fails to compile: TS2318 TS2304 TS2550
PASS  node --test src/*.test.ts (TypeScript run natively): 23 passing, 0 failing
PASS  tsc -p tsconfig.build.json emits to dist/
PASS  node --test dist/*.test.js (tsc output, target ES2022 helpers): 23 passing, 0 failing
PASS  target ES2022 emit contains the __addDisposableResource / __disposeResources helpers
PASS  target esnext emit keeps `await using` as written, with no helpers
PASS  SuppressedError fields identical on both paths, message is not — V8 "An error was suppressed during disposal" vs tsc helper "An error was suppressed during disposal.", same error/suppressed fields

all 9 checks passed
```

The same 23 tests run twice: once as TypeScript straight on Node (type
stripping, no build step), once after `tsc` has compiled them to `target:
ES2022`, where `using` becomes the `__addDisposableResource` /
`__disposeResources` helpers. Both paths have to agree.

## The claims, and the file that asserts each one

| Claim | Where |
| --- | --- |
| Three `await using` lines and three nested `try`/`finally` blocks produce the same trace, failing or not | `src/seed.ts` + `src/equivalence.test.ts` |
| Three `await using` lines close in reverse order of opening, at the end of the block | `src/order.test.ts` |
| A nested block closes its own resource first; the temp folder really is deleted and the connection really is closed | `src/order.test.ts` |
| `null` and `undefined` are legal resources and are skipped | `src/order.test.ts` |
| An object with no `Symbol.dispose` is a `TypeError` at the `using` line | `src/order.test.ts` |
| A loop closes each iteration's resource before the next opens, including on `break` and `continue` | `src/order.test.ts` |
| Cleanup runs when the body throws, in the same order, and the original error is what the caller sees | `src/on-throw.test.ts` |
| An early `return` closes everything; a resource never reached is never closed | `src/on-throw.test.ts` |
| Body error + cleanup error = one `SuppressedError`, `error` = the cleanup failure, `suppressed` = the original | `src/suppressed.test.ts` |
| A cleanup failure on its own propagates unwrapped, not boxed | `src/suppressed.test.ts` |
| Several failing cleanups nest, newest error outermost | `src/suppressed.test.ts` |
| `AsyncDisposableStack` handles a run-time number of resources, same reverse order | `src/stack.test.ts` |
| `use`, `defer` and `adopt` share one order; `move` hands ownership to the caller | `src/stack.test.ts` |
| The `lib` entry is required, not decorative | `src/lib-probe.ts` + `tsconfig.no-disposable-lib.json` |
| The `SuppressedError` message text differs between V8 and the `tsc` helper | `src/suppressed-message.ts` |

## Versions this was measured on

- Node **v26.1.0** on Windows 11. `using`, `await using`, `DisposableStack`,
  `AsyncDisposableStack` and `SuppressedError` are unflagged from Node **24.0.0**
  (MDN compatibility data). Not run on Linux or macOS.
- TypeScript **5.9.3**, `strict`, `target: ES2022`,
  `lib: ["ES2022", "ESNext.Disposable"]`. The syntax has been available since
  TypeScript 5.2.
- `npm run test` runs the TypeScript directly; `npm run test:compiled` builds
  first and runs the JavaScript.

## Run pieces of it

```bash
npm run typecheck      # tsc -p tsconfig.json
npm test               # node --test on the .ts files
npm run test:compiled  # tsc to dist/, then node --test on the .js files
node src/suppressed-message.ts     # the SuppressedError V8 builds
node dist/suppressed-message.js    # the one the tsc helper builds
```

MIT licensed. Nothing here talks to a network or writes outside the OS temp
folder.
