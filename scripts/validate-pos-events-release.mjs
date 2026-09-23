import { stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { releaseTestManifest } from
  "../artifacts/api-server/release-tests.manifest.mjs";

const workspaceDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const apiServerDir = path.join(workspaceDir, "artifacts", "api-server");
const requiredReleaseSuiteIds = Object.freeze([
  "pos-capability-audit",
  "pos-events-integration",
  "admin-role-access",
  "inventory-serialization",
  "stripe-adapter-contract",
  "stripe-sync-failure-monitor",
  "public-profile-image-retention",
  "object-storage-boundaries",
   "public-visits-integration",
   "malice-rules",
   "malice-order-claims",
   "daily-lunch-mutation",
   "daily-lunch-mutation-wiring",
   "restored-pos-migration",
  "public-stripe-webhook-integration",
  "offline-fiscal-native",
  "offline-fiscal-cloud",
]);

export async function validateReleaseManifest(
  manifest,
  requiredSuiteIds,
  baseDir,
) {
  const groups = Object.entries(manifest);
  if (groups.length === 0) {
    throw new Error("Release testni manifest je prazen.");
  }

  const suiteIds = new Map();
  const testPaths = new Map();
  for (const [groupId, group] of groups) {
    const suites = Object.entries(group?.suites ?? {});
    if (suites.length === 0) {
      throw new Error(`Release skupina \"${groupId}\" nima testov.`);
    }

    for (const [suiteId, relativePath] of suites) {
      if (suiteIds.has(suiteId)) {
        throw new Error(
          `Podvojen release sklop \"${suiteId}\" v skupinah ` +
          `\"${suiteIds.get(suiteId)}\" in \"${groupId}\".`,
        );
      }
      suiteIds.set(suiteId, groupId);

      if (
        typeof relativePath !== "string" ||
        path.isAbsolute(relativePath) ||
        relativePath.split(/[\\/]/).includes("..")
      ) {
        throw new Error(
          `Neveljavna release testna pot za \"${suiteId}\": ${relativePath}`,
        );
      }
      if (testPaths.has(relativePath)) {
        throw new Error(
          `Podvojena release testna pot \"${relativePath}\" pri sklopih ` +
          `\"${testPaths.get(relativePath)}\" in \"${suiteId}\".`,
        );
      }
      testPaths.set(relativePath, suiteId);

      let file;
      try {
        file = await stat(path.join(baseDir, relativePath));
      } catch {
        throw new Error(
          `Release testna datoteka ne obstaja: ${relativePath} (${suiteId}).`,
        );
      }
      if (!file.isFile()) {
        throw new Error(
          `Release testna pot ni datoteka: ${relativePath} (${suiteId}).`,
        );
      }
    }
  }

  for (const suiteId of requiredSuiteIds) {
    if (!suiteIds.has(suiteId)) {
      throw new Error(
        `V release manifestu manjka obvezni varnostni sklop: ${suiteId}.`,
      );
    }
  }

  return {
    groups: groups.length,
    suites: suiteIds.size,
  };
}

function runVitest(testPaths) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["exec", "vitest", "run", ...testPaths],
      { cwd: apiServerDir, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Vitest je bil prekinjen s signalom ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const groupId = process.argv[2];
  const group = releaseTestManifest[groupId];
  if (!group) {
    throw new Error(
      `Neznana release testna skupina \"${groupId ?? ""}\". ` +
      `Dovoljene: ${Object.keys(releaseTestManifest).join(", ")}.`,
    );
  }

  const summary = await validateReleaseManifest(
    releaseTestManifest,
    requiredReleaseSuiteIds,
    apiServerDir,
  );
  console.log(
    `Release manifest je veljaven: ${summary.suites} testnih sklopov ` +
    `v ${summary.groups} skupinah.`,
  );
  console.log(`\n=== ${group.label} ===\n`);
  process.exitCode = await runVitest(Object.values(group.suites));
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}