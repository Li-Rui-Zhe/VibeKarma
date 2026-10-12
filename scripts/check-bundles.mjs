import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const target = process.env.CARGO_TARGET_DIR ? path.resolve(root, process.env.CARGO_TARGET_DIR) : path.join(root, "src-tauri", "target");
const bundle = path.join(target, "release", "bundle");
const expected = process.platform === "win32" ? [["nsis", /-setup\.exe$/], ["msi", /\.msi$/]]
  : process.platform === "darwin" ? [["dmg", /\.dmg$/]] : [];
assert(expected.length, "Installer verification only supports Windows and macOS");
const arch = process.arch === "arm64" ? "aarch64" : "x64";
for (const [folder, extension] of expected) {
  const files = readdirSync(path.join(bundle, folder)).filter((name) => extension.test(name));
  assert.equal(files.length, 1, `Expected exactly one ${folder} installer`);
  const [name] = files;
  assert(name.includes(`_${version}_`), `Installer version mismatch: ${name}`);
  assert(name.includes(`_${arch}`), `Installer architecture mismatch: ${name}`);
  assert(statSync(path.join(bundle, folder, name)).size > 0, `Empty installer: ${name}`);
  console.log(`Verified installer: ${name}`);
}
