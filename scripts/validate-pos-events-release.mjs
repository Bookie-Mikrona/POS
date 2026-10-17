import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { releaseTestManifest } from
  "../artifacts/api-server/release-tests.manifest.mjs";
import { releaseTestManifest as erpManifest } from
  "../artifacts/erp-web/release-tests.manifest.mjs";
import { releaseTestManifest as posManifest } from
  "../artifacts/pos/release-tests.manifest.mjs";

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

// Keep required IDs separate from manifests so removing a suite fails closed.
const frontendPackages = Object.freeze({
  "erp-web": {
    manifest: erpManifest,
    requiredSuiteIds: [
      "event-transfer-diagnostics-csv", "admin-diagnostics-export",
      "bank-invalid-accounts", "bank-matching",
    ],
    requiredScripts: { "test:release": "erp" },
  },
  pos: {
    manifest: posManifest,
    requiredSuiteIds: [
      "unit-profiles", "auth-access", "auth-problem", "local-gateway-settings",
      "gateway-offline-store", "gateway-client", "kds-hook", "menu-meal-type",
    ],
    requiredScripts: { "test:release": "pos" },
  },
});

export function validateReleaseScripts(
  packageJson, requiredScripts, allowedGroupIds = Object.values(requiredScripts),
) {
  const scripts = packageJson.scripts ?? {};
  const allowedCommands = allowedGroupIds.map(
    (groupId) => `node ../../scripts/validate-pos-events-release.mjs ${groupId}`,
  );
  for (const [scriptName, command] of Object.entries(scripts)) {
    if (scriptName !== "test:release" && !scriptName.startsWith("test:release:")) {
      continue;
    }
    if (typeof command === "string" && /\.test\.tsx?\b/i.test(command)) {
      throw new Error(
        `Package script ${packageJson.name}:${scriptName} vsebuje neposredno ` +
        `testno pot; uporabi poimenovano skupino release manifesta.`,
      );
    }
    if (typeof command !== "string" || !allowedCommands.includes(command.trim())) {
      throw new Error(
        `Package script ${packageJson.name}:${scriptName} mora klicati ` +
        `dovoljeno release skupino: ${allowedGroupIds.map((id) => `"${id}"`).join(", ")}.`,
      );
    }
  }

  for (const [scriptName, groupId] of Object.entries(requiredScripts)) {
    const expected = `node ../../scripts/validate-pos-events-release.mjs ${groupId}`;
    if (typeof scripts[scriptName] !== "string" || scripts[scriptName].trim() !== expected) {
      throw new Error(
        `Package script ${packageJson.name}:${scriptName} mora klicati ` +
        `release skupino "${groupId}": ${expected}`,
      );
    }
  }
}

export async function validateFrontendReleasePackages(baseDir = workspaceDir) {
  for (const [packageDir, config] of Object.entries(frontendPackages)) {
    const dir = path.join(baseDir, "artifacts", packageDir);
    const packageJson = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
    validateReleaseScripts(
      packageJson, config.requiredScripts, Object.keys(config.manifest),
    );
    await validateReleaseManifest(config.manifest, config.requiredSuiteIds, dir);
  }
}

function runVitest(testPaths, cwd = apiServerDir, configArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["exec", "vitest", "run", ...configArgs, ...testPaths],
      { cwd, stdio: "inherit" },
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
  await validateFrontendReleasePackages();
  if (groupId === "--check") {
    console.log("ERP in POS release manifesta in paketni ukazi so veljavni.");
    return;
  }
  const frontend = Object.entries(frontendPackages).find(
    ([, config]) => Object.hasOwn(config.manifest, groupId),
  );
  const manifest = frontend?.[1].manifest ?? releaseTestManifest;
  const baseDir = frontend
    ? path.join(workspaceDir, "artifacts", frontend[0])
    : apiServerDir;
  const group = Object.hasOwn(manifest, groupId) ? manifest[groupId] : undefined;
  if (!group) {
    throw new Error(
      `Neznana release testna skupina \"${groupId ?? ""}\". ` +
      `Dovoljene: ${[
        ...Object.keys(releaseTestManifest), ...Object.keys(erpManifest),
        ...Object.keys(posManifest),
      ].join(", ")}.`,
    );
  }

  const summary = await validateReleaseManifest(
    manifest,
    frontend?.[1].requiredSuiteIds ?? requiredReleaseSuiteIds,
    baseDir,
  );
  console.log(
    `Release manifest je veljaven: ${summary.suites} testnih sklopov ` +
    `v ${summary.groups} skupinah.`,
  );
  console.log(`\n=== ${group.label} ===\n`);
  process.exitCode = await runVitest(
    Object.values(group.suites), baseDir,
    frontend ? ["--config", "vitest.config.ts"] : [],
  );
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