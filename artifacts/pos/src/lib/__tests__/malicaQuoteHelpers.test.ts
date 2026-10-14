import { test, expect, describe } from "vitest";
import { formatQuoteCents, formatLimitCents, isCourseIncluded, mapLimitErrorToMessage, formatContractPayloadModeValues } from "../malicaQuoteHelpers";
import type { MalicaQuoteCoursesItem } from "@workspace/api-client-react";

describe("malicaQuoteHelpers", () => {
  test("formatQuoteCents formats correctly", () => {
    expect(formatQuoteCents(1250)).toBe("12,50 €");
    expect(formatQuoteCents(0)).toBe("0,00 €");
  });

  test("formatLimitCents formats correctly", () => {
    expect(formatLimitCents(null)).toBe("Brez omejitve");
    expect(formatLimitCents(undefined)).toBe("Brez omejitve");
    expect(formatLimitCents(1500)).toBe("15,00 €");
  });

  test("isCourseIncluded returns true for included classification", () => {
    expect(isCourseIncluded({ classification: "included" } as MalicaQuoteCoursesItem)).toBe(true);
    expect(isCourseIncluded({ classification: "extra" } as MalicaQuoteCoursesItem)).toBe(false);
  });

  test("mapLimitErrorToMessage returns proper messages", () => {
    expect(mapLimitErrorToMessage("foo", 0, null, null)).toBe("Presežena dnevna omejitev malic");
    expect(mapLimitErrorToMessage("foo", 1, 0, null)).toBe("Presežena mesečna omejitev kritja za upravičenca");
    expect(mapLimitErrorToMessage("foo", 1, null, 0)).toBe("Presežena mesečna omejitev kritja po pogodbi");
    expect(mapLimitErrorToMessage("foo", 1, 100, 100)).toBeNull();
  });

  test("formatContractPayloadModeValues handles partner_fixed_guest_remainder properly", () => {
    expect(formatContractPayloadModeValues("partner_fixed_guest_remainder", "fixed", "5,50")).toEqual({ splitValue: 550 });
    expect(() => formatContractPayloadModeValues("partner_fixed_guest_remainder", "fixed", "-5")).toThrow();
    expect(() => formatContractPayloadModeValues("partner_fixed_guest_remainder", "fixed", "0")).toThrow();
  });

  test("formatContractPayloadModeValues handles split correctly", () => {
    expect(formatContractPayloadModeValues("split", "percent", "50")).toEqual({ splitKind: "percent", splitValue: 50 });
    expect(formatContractPayloadModeValues("split", "fixed", "10,25")).toEqual({ splitKind: "fixed", splitValue: 1025 });
  });

  test("formatContractPayloadModeValues ignores value for non-split modes", () => {
    expect(formatContractPayloadModeValues("partner_all", "fixed", "10")).toEqual({});
    expect(formatContractPayloadModeValues("guest_reduced_price", "fixed", "10")).toEqual({});
  });
});
