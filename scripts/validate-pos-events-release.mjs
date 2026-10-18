import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { releaseTestManifest as erpManifest } from
  "../artifacts/erp-web/release-tests.manifest.mjs";
import { releaseTestManifest as posManifest } from
  "../artifacts/pos/release-tests.manifest.mjs";

const workspaceDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const releasePackages = ["api-server", "erp-web", "pos"];
const requiredReleaseSuiteIds = Object.freeze([
  "pos-capability-audit",
  "pos-events-integration",
  "admin-role-access",
  "inventory-serialization",
  "stripe-adapter-contract",
  "stripe-sync-failure-monitor",
  "public-profile-image-retention",
  "object-storage-boundaries",
  "bank-statement-parse-contract",
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
      "server-pdf-only",
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
  const baseDir = path.join(workspaceDir, "artifacts", packageJson.name.split("/").at(-1));
  const scriptManifest = Object.fromEntries(allowedGroupIds.map(
    (groupId) => [groupId, { auxiliaryReason: "Script validation only." }],
  ));
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
    try {
      validateReleaseGroupCommands(scriptManifest, packageJson, baseDir, scriptName);
    } catch {
      throw new Error(
        `Package script ${packageJson.name}:${scriptName} mora klicati ` +
        `dovoljeno release skupino: ${allowedGroupIds.map((id) => `"${id}"`).join(", ")}.`,
      );
    }
  }

  for (const [scriptName, groupId] of Object.entries(requiredScripts)) {
    const expected = `node ../../scripts/validate-pos-events-release.mjs ${groupId}`;
    let reached = [];
    try {
      reached = validateReleaseGroupCommands(scriptManifest, packageJson, baseDir, scriptName);
    } catch {
      // Report the required group below, including when the entry is missing.
    }
    if (!reached.includes(groupId)) {
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

// The release graph deliberately supports only sequential pnpm aliases and the
// manifest runner. Shell conditionals, comments, echo, etc. are not proof that a
// group executes. New command forms must be supported explicitly, not guessed.
export function validateReleaseGroupCommands(
  manifest, packageJson, baseDir, entryScript = "test:release",
) {
  const packageName = packageJson.name ?? baseDir;
  const reached = new Set();
  const visiting = new Set();
  const visited = new Set();
  const fail = (message) => {
    throw new Error(`Release paket "${packageName}": ${message}`);
  };

  function visit(scriptId) {
    if (visiting.has(scriptId)) fail(`cikel package skriptov pri "${scriptId}".`);
    if (visited.has(scriptId)) return;
    const command = packageJson.scripts?.[scriptId];
    if (typeof command !== "string" || !command.trim()) {
      fail(`manjka izvajalni package skript "${scriptId}".`);
    }
    visiting.add(scriptId);
    for (const part of command.split("&&")) {
      const alias = /^pnpm run ([\w:-]+)$/.exec(part.trim());
      if (alias) {
        visit(alias[1]);
        continue;
      }
      const runner = /^node (\S+) ([\w-]+)(?: --package=([\w-]+))?$/.exec(part.trim());
      if (
        !runner ||
        path.resolve(baseDir, runner[1]) !== fileURLToPath(import.meta.url) ||
        (runner[3] ?? ({ erp: "erp-web", pos: "pos" }[runner[2]] ?? "api-server")) !== path.basename(baseDir)
      ) {
        fail(`nepodprt release ukaz v "${scriptId}": ${part.trim()}`);
      }
      if (!Object.hasOwn(manifest, runner[2])) {
        fail(`skript "${scriptId}" zahteva neznano skupino "${runner[2]}".`);
      }
      reached.add(runner[2]);
    }
    visiting.delete(scriptId);
    visited.add(scriptId);
  }

  visit(entryScript);
  for (const [groupId, group] of Object.entries(manifest)) {
    if (Object.hasOwn(group, "auxiliaryReason")) {
      if (typeof group.auxiliaryReason !== "string" || !group.auxiliaryReason.trim()) {
        fail(`pomožna skupina "${groupId}" potrebuje neprazen auxiliaryReason.`);
      }
    } else if (!reached.has(groupId)) {
      fail(
        `skupina "${groupId}" nima izvajalnega ukaza, dosegljivega iz ` +
        `"test:release". Pomožna skupina zahteva ekspliciten auxiliaryReason.`,
      );
    }
  }
  return [...reached];
}

export async function validateWorkspaceReleaseManifests() {
  const packages = new Map();
  for (const packageId of releasePackages) {
    const baseDir = path.join(workspaceDir, "artifacts", packageId);
    const { releaseTestManifest: manifest } = await import(
      pathToFileURL(path.join(baseDir, "release-tests.manifest.mjs")).href
    );
    const packageJson = JSON.parse(await readFile(path.join(baseDir, "package.json"), "utf8"));
    const frontend = frontendPackages[packageId];
    if (frontend) {
      validateReleaseScripts(packageJson, frontend.requiredScripts, Object.keys(manifest));
    }
    const summary = await validateReleaseManifest(
      manifest, frontend?.requiredSuiteIds ?? requiredReleaseSuiteIds, baseDir,
    );
    validateReleaseGroupCommands(manifest, packageJson, baseDir);
    packages.set(packageId, { manifest, baseDir, summary });
  }
  return packages;
}

function runGroup(group, baseDir) {
  const vitestConfig = path.basename(baseDir) === "api-server"
    ? []
    : ["--config", "vitest.config.ts"];
  const args = group.runner === "isolated-offline-fiscal"
    ? ["exec", "tsx", "scripts/run-isolated-offline-fiscal-tests.ts", ...Object.values(group.suites)]
    : ["exec", "vitest", "run", ...vitestConfig, ...Object.values(group.suites)];
  if (group.runner && group.runner !== "isolated-offline-fiscal") {
    throw new Error(`Neznan izvajalnik release testov: ${group.runner}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      args,
      { cwd: baseDir, stdio: "inherit" },
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
  // Validate every package before starting any tests, not just the selected group.
  const packages = await validateWorkspaceReleaseManifests();
  if (process.argv[2] === "--check") {
    console.log(`Release manifesti in izvajalni ukazi so veljavni (${packages.size} paketov).`);
    return;
  }
  const groupId = process.argv[2];
  const packageId = process.argv[3]?.replace(/^--package=/, "") ??
    ({ erp: "erp-web", pos: "pos" }[groupId] ?? "api-server");
  const selected = packages.get(packageId);
  if (!selected) throw new Error(`Neznan release paket "${packageId}".`);
  const group = selected.manifest[groupId];
  if (!group) {
    throw new Error(
      `Neznana release testna skupina \"${groupId ?? ""}\". ` +
      `Dovoljene: ${Object.keys(selected.manifest).join(", ")}.`,
    );
  }

  const { summary, baseDir } = selected;
  console.log(
    `Release manifest je veljaven: ${summary.suites} testnih sklopov ` +
    `v ${summary.groups} skupinah.`,
  );
  console.log(`\n=== ${group.label} ===\n`);
  process.exitCode = await runGroup(group, baseDir);
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