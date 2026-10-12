import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const target = process.env.CARGO_TARGET_DIR ? path.resolve(root, process.env.CARGO_TARGET_DIR) : path.join(root, "src-tauri", "target");
const macBundle = path.join(target, "release", "bundle", "macos", `${config.productName}.app`);
let executable;
if (process.argv[2]) {
  executable = path.resolve(process.argv[2]);
} else if (process.platform === "darwin") {
  const plist = path.join(macBundle, "Contents", "Info.plist");
  const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", plist], { encoding: "utf8" });
  assert.equal(result.status, 0, "Cannot read the macOS bundle executable");
  executable = path.join(macBundle, "Contents", "MacOS", result.stdout.trim());
  const arch = spawnSync("/usr/bin/lipo", ["-archs", executable], { encoding: "utf8" });
  assert.equal(arch.status, 0, "Cannot inspect the macOS binary architecture");
  assert.equal(arch.stdout.trim(), process.arch === "arm64" ? "arm64" : "x86_64", "The macOS bundle must match its runner architecture");
} else if (process.platform === "win32") {
  executable = path.join(target, "release", "vibekarma.exe");
} else {
  throw new Error("Native startup smoke checks support Windows and macOS only");
}
assert(existsSync(executable), `Native executable is missing: ${executable}`);
const output = path.join(root, ".cache", "native-smoke");
mkdirSync(output, { recursive: true });
const data = mkdtempSync(path.join(output, "data-"));
const report = { platform: process.platform, arch: process.arch, version: config.version, passed: false };
let child;
let exited = false;
let spawnError;
let logs = "";
try {
  child = spawn(executable, [], { env: { ...process.env, VIBEKARMA_DATA_DIR: data }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.once("exit", (code, signal) => { exited = true; report.exit = { code, signal }; });
  child.once("error", (error) => { spawnError = error; });
  const collect = (chunk) => { logs = (logs + chunk.toString("utf8")).slice(-262144); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  // Exercise native framework/WebView startup and storage initialization.
  // No Codex login, real chat, user authorization, or feedback is required here.
  for (let index = 0; index < 24; index++) {
    await pause(500);
    if (spawnError) throw spawnError;
    assert(!exited, `Native application exited during startup: ${JSON.stringify(report.exit)}`);
  }
  const database = path.join(data, "vibekarma.sqlite3");
  assert(existsSync(database), "Native storage did not initialize");
  assert.equal(readFileSync(database).subarray(0, 16).toString("ascii"), "SQLite format 3\0", "Native storage is not a valid SQLite database");
  assert(!/panicked at|error while running tauri application/i.test(logs), "Native startup reported a panic");
  report.passed = true;
  console.log(`Native startup passed (${report.platform}/${report.arch}): process survived 12 seconds and SQLite initialized.`);
  console.log("This check does not verify interactive permissions or real Codex chat reading.");
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(output, "startup.log"), logs);
  if (child?.pid && !exited) {
    child.kill();
    for (let index = 0; index < 10 && !exited; index++) await pause(100);
    if (!exited) child.kill("SIGKILL");
  }
}
