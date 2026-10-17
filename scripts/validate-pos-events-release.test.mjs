import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import {
  validateFrontendReleasePackages, validateReleaseManifest, validateReleaseScripts,
} from "./validate-pos-events-release.mjs";
import { releaseTestManifest as erpManifest } from "../artifacts/erp-web/release-tests.manifest.mjs";
import { releaseTestManifest as posManifest } from "../artifacts/pos/release-tests.manifest.mjs";

let tempDir;

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "release-manifest-"));
  await writeFile(path.join(tempDir, "one.test.ts"), "");
  await writeFile(path.join(tempDir, "two.test.ts"), "");
});

after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("sprejme enoličen manifest z obstoječimi datotekami", async () => {
  const result = await validateReleaseManifest({
    api: {
      suites: {
        one: "one.test.ts",
        two: "two.test.ts",
      },
    },
  }, ["one"], tempDir);

  assert.deepEqual(result, { groups: 1, suites: 2 });
});

test("zavrne podvojeno testno pot", async () => {
  await assert.rejects(
    validateReleaseManifest({
      api: {
        suites: {
          one: "one.test.ts",
          duplicate: "one.test.ts",
        },
      },
    }, [], tempDir),
    /Podvojena release testna pot "one\.test\.ts"/,
  );
});

test("zavrne manjkajočo testno datoteko", async () => {
  await assert.rejects(
    validateReleaseManifest({
      api: {
        suites: {
          missing: "missing.test.ts",
        },
      },
    }, [], tempDir),
    /Release testna datoteka ne obstaja: missing\.test\.ts/,
  );
});

test("zavrne odstranjen obvezni varnostni sklop", async () => {
  await assert.rejects(
    validateReleaseManifest({
      api: {
        suites: {
          one: "one.test.ts",
        },
      },
    }, ["critical-security-suite"], tempDir),
    /manjka obvezni varnostni sklop: critical-security-suite/,
  );
});

test("dejanska ERP in POS manifesta ter package scripts so veljavni", async () => {
  await validateFrontendReleasePackages();
});

for (const [packageDir, groupId, manifest] of [
  ["erp-web", "erp", erpManifest],
  ["pos", "pos", posManifest],
]) {
  const name = `@workspace/${packageDir}`;
  const required = { "test:release": groupId };
  const command = `node ../../scripts/validate-pos-events-release.mjs ${groupId}`;

  test(`${name}: sprejme poimenovano release skupino`, () => {
    assert.doesNotThrow(() => validateReleaseScripts({
      name, scripts: { "test:release": command, test: "vitest run one.test.ts" },
    }, required));
  });

  for (const extension of ["ts", "tsx"]) {
    for (const scriptName of ["test:release", "test:release:regression"]) {
      test(`${name}: zavrne neposredno .test.${extension} v ${scriptName}`, () => {
        assert.throws(() => validateReleaseScripts({
          name,
          scripts: {
            "test:release": command,
            [scriptName]: `${command} && vitest run "src/one.test.${extension}"`,
          },
        }, required), (error) => {
          assert.ok(error.message.includes(`${name}:${scriptName}`));
          assert.match(error.message, /neposredno testno pot/);
          return true;
        });
      });
    }
  }

  for (const invalid of [undefined, "", "vitest run", `node ../../scripts/validate-pos-events-release.mjs wrong-group`]) {
    test(`${name}: zavrne manjkajoč ali napačen ukaz ${JSON.stringify(invalid)}`, () => {
      assert.throws(() => validateReleaseScripts({
        name, scripts: { "test:release": invalid },
      }, required), (error) => {
        assert.ok(error.message.includes(`${name}:test:release`));
        assert.ok(error.message.includes(`"${groupId}"`));
        return true;
      });
    });
  }

  test(`${name}: zahtevani release podukaz mora klicati svojo skupino`, () => {
    const scripts = { "test:release": command, "test:release:core": command };
    const requiredSubcommand = { ...required, "test:release:core": groupId };
    assert.doesNotThrow(() => validateReleaseScripts({ name, scripts }, requiredSubcommand));
    scripts["test:release:core"] = "vitest run";
    assert.throws(() => validateReleaseScripts({ name, scripts }, requiredSubcommand),
      /test:release:core mora klicati dovoljeno release skupino/);
  });

  for (const bypass of [
    "vitest run src/pages",
    'vitest run "src/**/*.test.*"',
    "pnpm exec vitest run",
    `${command} && vitest run src/pages`,
    "node ../../scripts/validate-pos-events-release.mjs unknown",
  ]) {
    test(`${name}: dodatni release podukaz zavrne obvoz ${bypass}`, () => {
      assert.throws(() => validateReleaseScripts({
        name, scripts: { "test:release": command, "test:release:quick": bypass },
      }, required), (error) => {
        assert.ok(error.message.includes(`${name}:test:release:quick`));
        assert.match(error.message, /dovoljeno release skupino/);
        return true;
      });
    });
  }

  test(`${name}: dodatni podukaz sprejme le obstoječo dovoljeno skupino`, () => {
    const extra = "node ../../scripts/validate-pos-events-release.mjs regression";
    const packageJson = {
      name, scripts: { "test:release": command, "test:release:quick": extra },
    };
    assert.throws(() => validateReleaseScripts(packageJson, required),
      /test:release:quick mora klicati dovoljeno release skupino/);
    assert.doesNotThrow(() => validateReleaseScripts(
      packageJson, required, [groupId, "regression"],
    ));
  });

  test(`${name}: dejanski manifest zavrne podvojeno pot in odstranjen stabilni ID`, async () => {
    const suites = manifest[groupId].suites;
    const [requiredId, testPath] = Object.entries(suites)[0];
    const baseDir = new URL(`../artifacts/${packageDir}/`, import.meta.url).pathname;
    await assert.rejects(validateReleaseManifest({
      [groupId]: { suites: { ...suites, duplicate: testPath } },
    }, [], baseDir), /Podvojena release testna pot/);
    const { [requiredId]: removed, ...remaining } = suites;
    await assert.rejects(validateReleaseManifest({
      [groupId]: { suites: remaining },
    }, [requiredId], baseDir), /manjka obvezni varnostni sklop/);
  });
}

test("skupno preverjanje prebere in zavrne spremenjene ERP in POS package scripts", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "release-packages-"));
  try {
    for (const [packageDir, manifest] of [["erp-web", erpManifest], ["pos", posManifest]]) {
      const dir = path.join(fixture, "artifacts", packageDir);
      await mkdir(dir, { recursive: true });
      const packageJson = await readFile(
        new URL(`../artifacts/${packageDir}/package.json`, import.meta.url), "utf8",
      );
      await writeFile(path.join(dir, "package.json"), packageJson);
      for (const group of Object.values(manifest)) {
        for (const testPath of Object.values(group.suites)) {
          await mkdir(path.dirname(path.join(dir, testPath)), { recursive: true });
          await writeFile(path.join(dir, testPath), "");
        }
      }
    }
    await validateFrontendReleasePackages(fixture);
    for (const packageDir of ["erp-web", "pos"]) {
      const file = path.join(fixture, "artifacts", packageDir, "package.json");
      const original = await readFile(file, "utf8");
      const packageJson = JSON.parse(original);
      packageJson.scripts["test:release:extra"] = "vitest run src/bypass.test.tsx";
      await writeFile(file, JSON.stringify(packageJson));
      await assert.rejects(validateFrontendReleasePackages(fixture), (error) => {
        assert.ok(error.message.includes(`@workspace/${packageDir}:test:release:extra`));
        return true;
      });
      await writeFile(file, original);
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});