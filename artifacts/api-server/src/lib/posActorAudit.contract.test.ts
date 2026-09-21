import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routeFiles = [
  "quick-switch.ts",
  "terminal.ts",
  "racuni.ts",
] as const;

describe("POS actor audit pogodba", () => {
  it("ciljne route datoteke vse zapise pošljejo skozi skupni helper", async () => {
    for (const file of routeFiles) {
      const source = await readFile(path.resolve(process.cwd(), "src/routes/pos", file), "utf8");
      expect(source).not.toMatch(/INSERT\s+INTO\s+pos_actor_audit/i);
      expect(source).toContain("writePosActorAudit");
    }
  });
});