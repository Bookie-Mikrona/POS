import { describe, expect, it } from "vitest";
import {
  isAnyHappyHourActive,
  isHappyHourActiveForArticle,
  isHappyHourRuleActive,
  type HappyHourPravilo,
} from "./happy-hour";

function rule(overrides: Partial<HappyHourPravilo> = {}): HappyHourPravilo {
  return {
    id: "jutro",
    naziv: "Jutranja kava",
    od: "08:00",
    do: "11:00",
    dnevi: [1, 2, 3, 4, 5],
    artikelIds: [10, 11],
    ...overrides,
  };
}

describe("Happy Hour pravila", () => {
  it("upošteva lokalni čas in izbrane dneve v Europe/Ljubljana", () => {
    expect(isHappyHourRuleActive(rule(), new Date("2026-09-07T08:00:00Z"))).toBe(true);
    expect(isHappyHourRuleActive(rule(), new Date("2026-09-06T08:00:00Z"))).toBe(false);
  });

  it("enak začetek in konec obravnava kot celodnevno pravilo", () => {
    const allDay = rule({ od: "00:00", do: "00:00", dnevi: [1] });
    expect(isHappyHourRuleActive(allDay, new Date("2026-09-07T18:00:00Z"))).toBe(true);
  });

  it("nočni urnik po polnoči pripiše dnevu začetka", () => {
    const evening = rule({ od: "22:00", do: "02:00", dnevi: [5] });
    expect(isHappyHourRuleActive(evening, new Date("2026-09-11T20:30:00Z"))).toBe(true);
    expect(isHappyHourRuleActive(evening, new Date("2026-09-11T22:30:00Z"))).toBe(true);
    expect(isHappyHourRuleActive(evening, new Date("2026-09-12T01:00:00Z"))).toBe(false);
  });

  it("zniža samo artikel, ki je izbran v aktivnem pravilu", () => {
    const date = new Date("2026-09-07T08:00:00Z");
    expect(isHappyHourActiveForArticle([rule()], 10, "auto", date)).toBe(true);
    expect(isHappyHourActiveForArticle([rule()], 99, "auto", date)).toBe(false);
  });

  it("za vsako velikost pice neodvisno upošteva prekrivajoča se pravila", () => {
    const tuesdayMorning = new Date("2026-09-08T08:30:00Z");
    const tuesdayAfternoon = new Date("2026-09-08T13:00:00Z");
    const mondayMorning = new Date("2026-09-07T08:30:00Z");
    const rules = [
      rule({
        id: "male-vsak-dan",
        od: "10:00",
        do: "13:00",
        dnevi: [1, 2, 3, 4, 5, 6, 7],
        artikelIds: [10],
        velikostiPice: ["mala"],
      }),
      rule({
        id: "velike-torek",
        od: "00:00",
        do: "00:00",
        dnevi: [2],
        artikelIds: [10],
        velikostiPice: ["normalna"],
      }),
    ];

    expect(isHappyHourActiveForArticle(rules, 10, "auto", tuesdayMorning, "mala")).toBe(true);
    expect(isHappyHourActiveForArticle(rules, 10, "auto", tuesdayMorning, "normalna")).toBe(true);
    expect(isHappyHourActiveForArticle(rules, 10, "auto", tuesdayMorning, "druzinska")).toBe(false);
    expect(isHappyHourActiveForArticle(rules, 10, "auto", tuesdayAfternoon, "mala")).toBe(false);
    expect(isHappyHourActiveForArticle(rules, 10, "auto", tuesdayAfternoon, "normalna")).toBe(true);
    expect(isHappyHourActiveForArticle(rules, 10, "auto", mondayMorning, "mala")).toBe(true);
    expect(isHappyHourActiveForArticle(rules, 10, "auto", mondayMorning, "normalna")).toBe(false);
  });

  it("stara pravila brez izbire velikosti veljajo za vse velikosti", () => {
    const date = new Date("2026-09-07T08:00:00Z");
    expect(isHappyHourActiveForArticle([rule()], 10, "auto", date, "mala")).toBe(true);
    expect(isHappyHourActiveForArticle([rule()], 10, "auto", date, "normalna")).toBe(true);
    expect(isHappyHourActiveForArticle([rule()], 10, "auto", date, "druzinska")).toBe(true);
  });

  it("ročni vklop velja globalno tudi brez časovnih pravil", () => {
    expect(isHappyHourActiveForArticle([], 10, "on", new Date(), "mala")).toBe(true);
    expect(isAnyHappyHourActive([], "on")).toBe(true);
  });

  it("ročni izklop preglasi vsa aktivna pravila", () => {
    const date = new Date("2026-09-07T08:00:00Z");
    expect(isAnyHappyHourActive([rule()], "off", date)).toBe(false);
    expect(isHappyHourActiveForArticle([rule()], 10, "off", date)).toBe(false);
  });
});