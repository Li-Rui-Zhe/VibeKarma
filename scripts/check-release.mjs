import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8");
const version = JSON.parse(read("package.json")).version;
const cargo = read("src-tauri/Cargo.toml").split("[package]")[1]?.split("\n[")[0];
const versions = {
  "package.json": version,
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "src-tauri/Cargo.toml": cargo?.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
  "src-tauri/Cargo.lock": read("src-tauri/Cargo.lock").match(/name = "vibekarma"\s+version = "([^"]+)"/)?.[1],
};
assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Installer releases need a numeric major.minor.patch version");
for (const [file, value] of Object.entries(versions)) {
  assert.equal(value, version, `${file} must match package.json`);
}
const tag = `v${version}`;
assert(existsSync(path.join(root, "docs", "releases", `${tag}.md`)), `Release notes are missing for ${tag}`);
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.equal(process.env.GITHUB_REF_NAME, tag, "The Git tag must match the application version");
}
console.log(`Release versions and notes verified: ${tag}`);
