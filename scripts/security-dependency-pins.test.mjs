import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const excluded = new Set([
  "node_modules", ".git", "vendor", ".venv", "venv", "target", "dist",
  "build", ".next", ".cache", ".gradle", ".gradle-nb80",
  "generated-artifacts",
]);
const dependencyFiles = new Set([
  "package.json", "package-lock.json", "npm-shrinkwrap.json",
  "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock",
]);
const vulnerable = [
  ["js-yaml", "4.3.1"],
  ["@vitest/mocker", "4.1.10"],
  ["vitest", "4.1.10"],
  ["multer", "2.2.0"],
  ["nodemailer", "9.0.3"],
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(directory, entry.name);
    // Prune before recursion, including untracked nested projects.
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name) &&
          !fullPath.startsWith(path.join(root, ".local", "share")) &&
          !fullPath.startsWith(path.join(root, ".local", "state"))) {
        files.push(...await walk(fullPath));
      }
    } else if (dependencyFiles.has(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

test("no reported vulnerable dependency versions remain in any manifest or lockfile", async () => {
  const files = await walk(root);
  assert.ok(files.includes(path.join(root, "pnpm-lock.yaml")));
  assert.ok(files.includes(path.join(root, "artifacts/api-server/package.json")));
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const [name, version] of vulnerable) {
      const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // JSON declarations, npm/yarn/pnpm package keys and pnpm snapshots.
      const pin = new RegExp(
        `["']?${escape(name)}(?:["']?\\s*:\\s*["']?[~^]?|@)${escape(version)}(?![\\d.])`,
      );
      assert.ok(!pin.test(content), `${path.relative(root, file)} pins ${name}@${version}`);
    }
  }
});
