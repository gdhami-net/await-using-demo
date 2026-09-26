// Runs everything the post claims and prints one PASS/FAIL line per claim.
// Exit code 1 if any line fails.
//
//   npm install
//   npm run check

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import process from "node:process";

const NODE_MIN = 24; // MDN compat data: using / await using / DisposableStack
const TESTS = ["equivalence", "order", "on-throw", "suppressed", "stack"];
const results = [];

function record(ok, line) {
  results.push({ ok, line });
  console.log(`${ok ? "PASS" : "FAIL"}  ${line}`);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

const tsc = ["node_modules/typescript/bin/tsc"];
const tsVersion = execFileSync(process.execPath, [...tsc, "--version"], { encoding: "utf8" }).trim();
const nodeMajor = Number(process.versions.node.split(".")[0]);

console.log(`node ${process.version}  ·  ${tsVersion}`);
console.log("");

// 1. The runtime this check is running on has the feature at all.
record(
  nodeMajor >= NODE_MIN &&
    typeof DisposableStack === "function" &&
    typeof AsyncDisposableStack === "function" &&
    typeof SuppressedError === "function" &&
    typeof Symbol.dispose === "symbol" &&
    typeof Symbol.asyncDispose === "symbol",
  `Node ${process.versions.node} has Symbol.dispose, Symbol.asyncDispose, DisposableStack, AsyncDisposableStack, SuppressedError`,
);

// 2. The source typechecks under --strict with target ES2022.
{
  const r = run(process.execPath, [...tsc, "-p", "tsconfig.json"]);
  record(r.status === 0, "src typechecks under strict, target ES2022, lib ES2022 + ESNext.Disposable");
  if (r.status !== 0) console.log((r.stdout || "") + (r.stderr || ""));
}

// 3. lib matters: drop ESNext.Disposable and the same file stops compiling.
{
  const r = run(process.execPath, [...tsc, "-p", "tsconfig.no-disposable-lib.json"]);
  const out = (r.stdout || "") + (r.stderr || "");
  const codes = [...new Set(out.match(/TS\d+/g) ?? [])].join(" ");
  record(
    r.status !== 0 && /TS2318/.test(out) && /TS2550/.test(out),
    `without ESNext.Disposable in lib, the same file fails to compile: ${codes || "no errors — unexpected"}`,
  );
}

// 4. Node runs the TypeScript directly (type stripping, no build step).
{
  const r = run(process.execPath, ["--test", ...TESTS.map((t) => `src/${t}.test.ts`)]);
  const out = (r.stdout || "") + (r.stderr || "");
  const pass = /^[#ℹ]\s*fail 0$/m.test(out) && r.status === 0;
  record(pass, `node --test src/*.test.ts (TypeScript run natively): ${countTests(out)}`);
  if (!pass) console.log(out.slice(-3000));
}

// 5. tsc downlevels to ES2022 helpers and the same tests still pass.
{
  rmSync("dist", { recursive: true, force: true });
  const build = run(process.execPath, [...tsc, "-p", "tsconfig.build.json"]);
  if (build.status !== 0) {
    record(false, "tsc -p tsconfig.build.json emits to dist/");
    console.log((build.stdout || "") + (build.stderr || ""));
  } else {
    record(true, "tsc -p tsconfig.build.json emits to dist/");
    const r = run(process.execPath, ["--test", ...TESTS.map((t) => `dist/${t}.test.js`)]);
    const out = (r.stdout || "") + (r.stderr || "");
    const pass = /^[#ℹ]\s*fail 0$/m.test(out) && r.status === 0;
    record(pass, `node --test dist/*.test.js (tsc output, target ES2022 helpers): ${countTests(out)}`);
    if (!pass) console.log(out.slice(-3000));
  }
}

// 6. Target ES2022 emits the helpers; target esnext emits `using` untouched.
{
  const downlevel = readEmit("dist/on-throw.test.js");
  record(
    /__addDisposableResource/.test(downlevel) && /__disposeResources/.test(downlevel),
    "target ES2022 emit contains the __addDisposableResource / __disposeResources helpers",
  );
  rmSync("tmp-esnext", { recursive: true, force: true });
  const r = run(process.execPath, [
    ...tsc,
    "-p", "tsconfig.build.json",
    "--target", "esnext",
    "--outDir", "tmp-esnext",
  ]);
  const native = r.status === 0 ? readEmit("tmp-esnext/on-throw.test.js") : "";
  record(
    r.status === 0 && /await using /.test(native) && !/__addDisposableResource/.test(native),
    "target esnext emit keeps `await using` as written, with no helpers",
  );
  rmSync("tmp-esnext", { recursive: true, force: true });
}

// 7. The SuppressedError message differs between the two paths; the fields do not.
{
  const nativeRun = run(process.execPath, ["src/suppressed-message.ts"]);
  const compiledRun = run(process.execPath, ["dist/suppressed-message.js"]);
  let ok = false;
  let detail = "could not read both runs";
  try {
    const a = JSON.parse(nativeRun.stdout.trim());
    const b = JSON.parse(compiledRun.stdout.trim());
    ok =
      a.name === "SuppressedError" &&
      b.name === "SuppressedError" &&
      a.error === "could not close db" &&
      b.error === "could not close db" &&
      a.suppressed === "seed script failed on row 4" &&
      b.suppressed === "seed script failed on row 4" &&
      a.message === "An error was suppressed during disposal" &&
      b.message === "An error was suppressed during disposal.";
    detail = `V8 ${JSON.stringify(a.message)} vs tsc helper ${JSON.stringify(b.message)}, same error/suppressed fields`;
  } catch {
    detail += `: ${nativeRun.stdout || nativeRun.stderr} | ${compiledRun.stdout || compiledRun.stderr}`;
  }
  record(ok, `SuppressedError fields identical on both paths, message is not — ${detail}`);
}

function countTests(out) {
  const pass = out.match(/^[#ℹ]\s*pass (\d+)$/m);
  const fail = out.match(/^[#ℹ]\s*fail (\d+)$/m);
  return `${pass ? pass[1] : "?"} passing, ${fail ? fail[1] : "?"} failing`;
}

function readEmit(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

console.log("");
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `all ${results.length} checks passed` : `${failed.length} of ${results.length} checks FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
