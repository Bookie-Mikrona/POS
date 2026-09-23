import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { validateReleaseManifest } from "./validate-pos-events-release.mjs";

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