import { describe, expect, it } from "vitest";
import type { KdsNalog } from "@/hooks/use-kds";
import { getKdsItemAppearance, getOrderItemKdsStatuses } from "./kdsItemStatus";

const now = Date.parse("2026-10-03T12:00:00Z");
const station = { id: 1, ime: "Kuhinja", tip: "kitchen" };
const ticket = (minutes: number, stanje: KdsNalog["stanje"] = "aktivno"): KdsNalog => ({
  id: 1, enotaId: 5, narociloId: 9, postavkaId: 3, postajaId: 1,
  stanje, uporabljenFallback: false,
  ustvarjeno: new Date(now - minutes * 60_000).toISOString(),
});

describe("shared KDS and order item colors", () => {
  it.each([
    [0, "bg-green-50", "bg-green-500"],
    [9.99, "bg-green-50", "bg-green-500"],
    [10, "bg-orange-50", "bg-orange-400"],
    [19.99, "bg-orange-50", "bg-orange-400"],
    [20, "bg-red-100", "bg-red-500"],
    [116, "bg-red-100", "bg-red-500"],
  ])("uses the same urgency classes after %s minutes", (minutes, background, badge) => {
    const result = getKdsItemAppearance(ticket(minutes), false, now)!;
    expect(result.className).toContain(background);
    expect(result.badgeClassName).toContain(badge);
    expect(result.label).toBe("V pripravi");
    expect(getOrderItemKdsStatuses(3, [ticket(minutes)], [station], now).className)
      .toBe(result.className);
  });

  it("starts the clock at FIRE, not when a held course was created", () => {
    const result = getKdsItemAppearance({
      ...ticket(90), aktiviranoAt: new Date(now - 2 * 60_000).toISOString(),
    }, false, now)!;
    expect(result.minutes).toBe(2);
    expect(result.className).toContain("bg-green-50");
  });

  it("does not age held or completed tickets into red", () => {
    expect(getKdsItemAppearance(ticket(90, "zadrzano"), false, now))
      .toMatchObject({ label: "Na čakanju", minutes: null, className: expect.stringContaining("bg-slate-100") });
    expect(getKdsItemAppearance(ticket(90, "bumped"), false, now))
      .toMatchObject({ label: "Pripravljeno", minutes: null, className: expect.stringContaining("bg-emerald-100") });
    expect(getKdsItemAppearance(ticket(90, "ack"), false, now)?.label).toBe("Predano");
  });

  it("matches the special bar preparation color", () => {
    const bar = { id: 2, ime: "Točilnica", tip: "bar" };
    const nalog = { ...ticket(25), postajaId: 2 };
    const result = getOrderItemKdsStatuses(3, [nalog], [bar], now);
    expect(result.className).toContain("bg-fuchsia-50");
    expect(result.statuses[0]).toMatchObject({ stationName: "Točilnica", label: "Pripravi pijačo" });
  });

  it("shows every station and does not mark partially completed items as ready", () => {
    const nalogi = [ticket(50, "bumped"), { ...ticket(21), id: 2, postajaId: 2 }];
    const result = getOrderItemKdsStatuses(3, nalogi,
      [station, { id: 2, ime: "Pica", tip: "pizza" }], now);
    expect(result.statuses.map(status => status.label)).toEqual(["Pripravljeno", "V pripravi"]);
    expect(result.className).toContain("bg-red-100");
    expect(getOrderItemKdsStatuses(3, [nalogi[0], { ...nalogi[1], stanje: "zadrzano" }], [station], now).className)
      .toContain("bg-slate-100");
  });

  it("ignores cancelled and other-item tickets; untracked items remain neutral", () => {
    expect(getOrderItemKdsStatuses(3,
      [ticket(40, "preklicano"), { ...ticket(40), postavkaId: 4 }], [station], now))
      .toEqual({ className: "", statuses: [] });
  });

  it("retains ready color after completed tickets leave the live endpoint", () => {
    expect(getOrderItemKdsStatuses(3, [], [station], now, "2026-10-03T11:59:00Z").className)
      .toContain("bg-emerald-100");
  });

  it("supports string gateway line identifiers", () => {
    const nalog = { ...ticket(12), postavkaId: "gw-line" as unknown as number };
    expect(getOrderItemKdsStatuses("gw-line", [nalog], [station], now).className)
      .toContain("bg-orange-50");
  });
});