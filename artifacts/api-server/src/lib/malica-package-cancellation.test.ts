import { describe, expect, it } from "vitest";
import {
  countLiveMalicaQuantity,
  isPackageAlreadyCancelled,
  packageHasBilledRow,
  resolveMalicaPackageRows,
} from "./malica-package-cancellation";

const rows = [
  { id: 10, pairingGroupId: "malica:s1m1d0:abc", packageStatus: "active" as const, racunId: null },
  { id: 11, pairingGroupId: "malica:s1m1d0:abc", packageStatus: "active" as const, racunId: null },
  { id: 20, pairingGroupId: "malica:s1m1d0:other", packageStatus: "active" as const, racunId: null },
];

describe("varna odstranitev paketa Malice", () => {
  it("iz parent ali KDS otroka razreši vse vrstice istega paketa", () => {
    expect(resolveMalicaPackageRows(rows, 10).map((row) => row.id)).toEqual([10, 11]);
    expect(resolveMalicaPackageRows(rows, 11).map((row) => row.id)).toEqual([10, 11]);
    expect(resolveMalicaPackageRows(rows, 20).map((row) => row.id)).toEqual([20]);
  });

  it("ne obravnava navadnih pairing skupin kot Malico", () => {
    expect(resolveMalicaPackageRows([
      { id: 1, pairingGroupId: "multicourse:1", packageStatus: "active", racunId: null },
    ], 1)).toEqual([]);
  });

  it("ponovljena odstranitev je idempotentna, računana vrstica pa blokira odstranitev", () => {
    expect(isPackageAlreadyCancelled(rows.map((row) => ({ ...row, packageStatus: "cancelled" as const })))).toBe(true);
    expect(packageHasBilledRow([{ ...rows[0], racunId: 99 }])).toBe(true);
    expect(packageHasBilledRow(rows)).toBe(false);
  });

  it("preklicani paket sprosti količino za naslednjo prodajo", () => {
    expect(countLiveMalicaQuantity([
      { packageStatus: "active", quantity: 1 },
      { packageStatus: "cancelled", quantity: 1 },
    ])).toBe(1);
  });
});