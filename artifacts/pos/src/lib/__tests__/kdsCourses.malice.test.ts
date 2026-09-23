import { test, expect, describe } from "vitest";
import { inferMalicaKdsComposition } from "../kdsCourses";

describe("inferMalicaKdsComposition", () => {
  test("returns null if pairingGroupId does not start with malica:", () => {
    expect(inferMalicaKdsComposition("degustacija:abc")).toBeNull();
  });

  test("returns null for legacy malica formats", () => {
    expect(inferMalicaKdsComposition("malica:12345")).toBeNull();
  });

  test("infers samo_glavna_jed", () => {
    expect(inferMalicaKdsComposition("malica:s0m1d0:12345")).toBe("samo_glavna_jed");
  });

  test("infers brez_juhe", () => {
    expect(inferMalicaKdsComposition("malica:s0m1d1:12345")).toBe("brez_juhe");
  });
  
  test("infers brez_sladice", () => {
    expect(inferMalicaKdsComposition("malica:s1m1d0:12345")).toBe("brez_sladice");
  });

  test("infers celotna", () => {
    expect(inferMalicaKdsComposition("malica:s1m1d1:12345")).toBe("celotna");
  });

  test("returns null for malica structures missing course 2 (m0)", () => {
    expect(inferMalicaKdsComposition("malica:s1m0d1:12345")).toBeNull();
  });
});
