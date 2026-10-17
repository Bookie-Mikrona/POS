import { describe, expect, it } from "vitest";
import {
  describeAgentCommandShape,
  findRepeatableOpenTableNumber,
  findCourseClarificationOptions,
  fingerprintCourseClarificationOrder,
  isOpenOwnShiftCommand,
  isRepeatLastAgentCommand,
  isSafeAgentStaticNavigation,
  isSafeAgentSettingsNavigation,
  isMisSettingsCommand,
  parseOpenTableOrderCommand,
  parseTableStatusQuestion,
  parseSlovenianTableNumber,
  POS_AGENT_CATALOG,
  PosAgentBodySchema,
  PosAgentFallbackSchema,
  PosAgentToolSchema,
  navigationForCommand,
  parseCourseAssignmentCommand,
  parseMultiCourseAssignmentCommand,
  redactAgentOrder,
  resolveNamedCourseReference,
  signCourseClarificationToken,
  encodeCourseClarificationToken,
  validateCourseClarificationContinuation,
  verifyCourseClarificationToken,
  resolveExactAgentEntity,
  resolveAgentAction,
  redactAgentPromptText,
  resolveAgentTableDisplayState,
  resolvePosAgentCommand,
} from "./glasovni-ukaz";
import { resolveUnitCapability } from "../../middlewares/pos";

describe("operativni POS AI agent contract", () => {
  it("deterministically resolves only tenant normative candidates", () => {
    expect(resolvePosAgentCommand("primerjaj normativ za GOLAŽ", [{ id: 7, ime: "Golaž" }]))
      .toMatchObject({ action: "compare_normative", artikelId: 7, forceRefresh: false });
    expect(resolvePosAgentCommand("na novo primerjaj normativ za golaž", [{ id: 7, ime: "Golaž" }]))
      .toMatchObject({ action: "compare_normative", artikelId: 7, forceRefresh: true });
    expect(resolvePosAgentCommand("osveži primerjavo normativa za golaž", [{ id: 7, ime: "Golaž" }]))
      .toMatchObject({ action: "compare_normative", artikelId: 7, forceRefresh: true });
    expect(resolvePosAgentCommand("primerjaj normativ za sveža solata", [{ id: 9, ime: "Sveža solata" }]))
      .toMatchObject({ action: "compare_normative", artikelId: 9, forceRefresh: false });
    expect(resolvePosAgentCommand("preveri recept za golaž", [{ id: 7, ime: "Golaž goveji" }, { id: 8, ime: "Golaž veganski" }]))
      .toMatchObject({ action: "explain" });
    expect(resolvePosAgentCommand("primerjaj normativ za pica", [{ id: 7, ime: "Golaž" }]))
      .toMatchObject({ action: "explain" });
  });
  it("has an explicit real-module catalog and forbids critical flow mutations", () => {
    expect(POS_AGENT_CATALOG).toContain("artikli");
    expect(POS_AGENT_CATALOG).toContain("naročila");
    expect(POS_AGENT_CATALOG).toMatch(/Nikoli ne izvajaj plačil, fiskalizacije, izdaje računa/);
  });

  it("accepts only bounded text commands and a canonical order reference", () => {
    expect(PosAgentBodySchema.safeParse({ ukaz: "Ustvari sok", narociloId: 12 }).success).toBe(true);
    expect(PosAgentBodySchema.safeParse({ ukaz: " " }).success).toBe(false);
    expect(PosAgentBodySchema.safeParse({ ukaz: "x".repeat(1001) }).success).toBe(false);
  });

  it("does not permit a model-invented critical action", () => {
    expect(PosAgentToolSchema.safeParse({ odgovor: "ok", action: "fiscalize_receipt" }).success).toBe(false);
    expect(PosAgentToolSchema.safeParse({ odgovor: "Dodajam.", action: "add_item", narociloId: 12, artikelId: 5, kolicina: 1 }).success).toBe(true);
  });

  it("maps every agent route to checkout capability", () => {
    expect(resolveUnitCapability("/ai/agent")).toBe("checkout");
    expect(resolveUnitCapability("/ai/agent/history")).toBe("checkout");
    expect(resolveUnitCapability("/ai/agent/memory")).toBe("checkout");
  });

  it("redacts customer PII before sending canonical order context to Claude", () => {
    const redacted = redactAgentOrder({
      id: 1, nacin: "dostava", status: "odprto", miza: null, strankaIme: "Ana Novak",
      telefon: "+38640123456", naslovDostave: "Tajna 1", skupaj: 2,
      postavke: [{ id: 3, artikelId: 4, naziv: "Kava", kolicina: 1, skupaj: 2, opomba: "Pokliči Ano", parentPostavkaId: null, racunId: null }],
    });
    expect(JSON.stringify(redacted)).not.toContain("Ana");
    expect(JSON.stringify(redacted)).not.toContain("386");
    expect(JSON.stringify(redacted)).not.toContain("Tajna");
  });

  it("keys learned memory by waiter actor as well as unit", () => {
    // The actor id is mandatory in both audit and memory schema and is included
    // in the DB unique key; an actor A reset/query can therefore never target B.
    expect(resolveUnitCapability("/ai/agent/history")).toBe("checkout");
    expect(PosAgentBodySchema.safeParse({ ukaz: "ponovi", pot: "/artikli" }).success).toBe(true);
  });

  it.each([
    ["odpri novo naročilo na mizi 1", 1],
    ["odpri novo naročilo na mizi ena", 1],
    ["odpri naročilo za mizo enka", 1],
    ["odpri novo naročilo na mizi Miza 1", 1],
    ["odpri mi novo naročilo na mizi ena", 1],
    ["odpri na mizi številka ena novo naročilo", 1],
    ["prosim odpri novo naročilo za mizo številka štiri", 4],
    ["želim, da AI agent odpre novo naročilo na mizi ena", 1],
    ["prosim, da odpreš novo naročilo na mizi dve", 2],
    ["odpri novo naročilo na mizi ena", 1],
    ["odpri novo naročila na mizo eno", 1],
    ["Odpri naročilo za mizo 12", 12],
    ["odpri naročilo na mizi štiri", 4],
    ["odpri poročilo na mizi 1", null],
    ["odpri novo naročilo na mizi 0", null],
    ["odpri novo naročilo na mizi neznani", null],
  ])("deterministično prepozna ukaz za naročilo na mizi", (command, expected) => {
    expect(parseOpenTableOrderCommand(command)).toBe(expected);
  });

  it("za diagnostiko hrani samo neosebno obliko ukaza", () => {
    expect(describeAgentCommandShape("odpri novo naročilo na mizi ena")).toEqual({
      hasOpenVerb: true,
      hasOrderNoun: true,
      hasTableNoun: true,
      hasNumberToken: true,
    });
    expect(JSON.stringify(describeAgentCommandShape("Ana +386 40 123 456"))).not.toContain("Ana");
    expect(JSON.stringify(describeAgentCommandShape("Ana +386 40 123 456"))).not.toContain("386");
  });

  it("razreši samo natančno normalizirano enolično ime", () => {
    expect(resolveExactAgentEntity("  Čaj   Meta ", [{ ime: "čaj meta", id: 1 }])).toEqual({ ime: "čaj meta", id: 1 });
    expect(resolveExactAgentEntity("čaj", [{ ime: "Čaj meta", id: 1 }])).toBeNull();
    expect(resolveExactAgentEntity("čaj", [{ ime: "Čaj", id: 1 }, { ime: "čaj", id: 2 }])).toBe("ambiguous");
  });

  it.each([
    ["odpri račune", "/racuni"],
    ["pokaži zaloge", "/zaloge"],
    ["odpri rezervacije", "/rezervacije"],
    ["prikaži poročila", "/operativna-porocila"],
  ])("prepozna sklanjane navigacijske ukaze", (command, path) => {
    expect(navigationForCommand(command)).toBe(path);
  });

  it.each([
    ["odpri nastavitve tiskalnika bluetooth", "/nastavitve?tab=nastavitve&section=sek-tiskalniki&card=ns-android-tiskalnik"],
    ["pokaži FURS certifikat", "/nastavitve?tab=nastavitve&section=sek-podjetje&card=ns-certifikat"],
    ["prikaži BizBox", "/nastavitve?tab=nastavitve&section=sek-eracun&card=ns-bizbox"],
    ["pojdi na nastavitve KDS", "/nastavitve?tab=kds"],
    ["ogled glasovnih ukazov", "/nastavitve?tab=glasovni-ukazi"],
    ["nastavi SumUp", "/nastavitve?tab=nastavitve&section=sek-terminali&card=ns-sumup"],
  ])("deterministično razreši obstoječe nastavitve", (command, path) => {
    expect(navigationForCommand(command)).toBe(path);
  });

  it("dovoli le kanonične query povezave nastavitev", () => {
    expect(isSafeAgentSettingsNavigation("/nastavitve?tab=nastavitve&section=sek-terminali&card=ns-viva")).toBe(true);
    expect(isSafeAgentStaticNavigation("/nastavitve?tab=nastavitve&section=sek-terminali&card=ns-viva")).toBe(true);
    expect(isSafeAgentSettingsNavigation("/nastavitve?tab=nastavitve&card=ns-viva")).toBe(false);
    expect(isSafeAgentSettingsNavigation("/nastavitve?tab=nastavitve&section=sek-terminali&card=ns-viva&save=true")).toBe(false);
    expect(isSafeAgentSettingsNavigation("/nastavitve?tab=nastavitve&tab=kds")).toBe(false);
    expect(isSafeAgentSettingsNavigation("/nastavitve?tab=nastavitve&section=sek-terminali&section=sek-sistem")).toBe(false);
    expect(isSafeAgentSettingsNavigation("/nastavitve?tab=nastavitve&section=sek-terminali&card=ns-viva&card=ns-viva")).toBe(false);
  });

  it.each([
    ["odpri nastavitve tiskalnika"],
    ["odpri nastavitve tiskalnikov"],
    ["pokaži tiskalnike"],
  ])("odpre splošni razdelek tiskalnikov brez izbire naprave", command => {
    expect(navigationForCommand(command)).toBe("/nastavitve?tab=nastavitve&section=sek-tiskalniki");
  });

  it.each(["odpri nastavitve MIS", "odpri nastavitve mis", "odpri nastavitve miz"])(
    "varno odpre nastavitve miz za prepis: %s", command => {
      expect(navigationForCommand(command)).toBe("/nastavitve?tab=mize");
    },
  );

  it("MIS ne obravnava kot mize zunaj konteksta nastavitev", () => {
    expect(isMisSettingsCommand("to je misel za jutri")).toBe(false);
    expect(navigationForCommand("to je misel za jutri")).toBeNull();
  });

  it.each(["odpri nastavitve MIS", "odpri nastavitve mis", "odpri nastavitve miz"])(
    "resolver prepis %s usmeri na kanonični zavihek miz", async command => {
      await expect(resolveAgentAction(command, undefined, 1)).resolves.toMatchObject({
        action: "navigate", navigateTo: "/nastavitve?tab=mize",
      });
    },
  );

  it.each([
    ["nastavi kavo na hod 2", { itemName: "kavo", courseNumber: 2 }],
    ["dodeli kavo hodu 2", { itemName: "kavo", courseNumber: 2 }],
    ["daj juho na prvi hod", { itemName: "juho", courseNumber: 1 }],
    ["nastavi kavo na hod 0", null],
  ])("razčleni dodelitev obstoječe postavke hodu", (command, expected) => {
    expect(parseCourseAssignmentCommand(command)).toEqual(expected);
  });

  it("razčleni imenovan hod, ne da bi ga spremenil v javno mutacijo", () => {
    expect(parseCourseAssignmentCommand("daj vino k ribjemu hodu")).toEqual({ itemName: "vino", courseName: "ribjemu" });
    expect(parseCourseAssignmentCommand("sladico na zaključni hod")).toEqual({ itemName: "sladico", courseName: "zakljucni" });
  });

  it("razčleni več ločenih skupin postavk za hode", () => {
    expect(parseMultiCourseAssignmentCommand("juho in solato na prvi hod, zrezek na drugi")).toEqual([
      { itemName: "juho", courseNumber: 1 },
      { itemName: "solato", courseNumber: 1 },
      { itemName: "zrezek", courseNumber: 2 },
    ]);
    expect(parseMultiCourseAssignmentCommand("vino k ribjemu hodu, zrezek na drugi")).toEqual([
      { itemName: "vino", courseName: "ribjemu" },
      { itemName: "zrezek", courseNumber: 2 },
    ]);
  });

  it("razreši samo celotna, normalizirana imena hodov in nadzorovane sklone", () => {
    expect(resolveNamedCourseReference("zaključni", [{ courseNumber: 3, courseName: "Zaključni hod" }])).toBe(3);
    expect(resolveNamedCourseReference("zaključnemu", [{ courseNumber: 3, courseName: "Zaključni hod" }])).toBe(3);
    expect(resolveNamedCourseReference("ribjemu", [{ courseNumber: 2, courseName: "Ribji hod" }])).toBe(2);
    expect(resolveNamedCourseReference("sladico", [{ courseNumber: 4, courseName: "Sladica" }])).toBe(4);
    expect(resolveNamedCourseReference("ribji", [
      { courseNumber: 2, courseName: "Ribji hod" },
      { courseNumber: 3, courseName: "Ribji posebni hod" },
    ])).toBe("ambiguous");
  });

  it("ne ugiba pri podobnih imenih ali poljubnih končnicah", () => {
    expect(resolveNamedCourseReference("vin", [{ courseNumber: 1, courseName: "Vino" }])).toBeNull();
    expect(resolveNamedCourseReference("ribji", [{ courseNumber: 2, courseName: "Ribji posebni hod" }])).toBeNull();
  });

  it("pri podobnih imenih ponudi samo konkretne povezane možnosti, sicer vse razpoložljive", () => {
    const courses = [
      { courseNumber: 1, courseName: "Hladna predjed" },
      { courseNumber: 2, courseName: "Ribji hod" },
      { courseNumber: 3, courseName: "Ribji posebni hod" },
    ];
    expect(findCourseClarificationOptions("ribji", courses)).toEqual([
      { courseNumber: 2, courseName: "Ribji hod" },
      { courseNumber: 3, courseName: "Ribji posebni hod" },
    ]);
    expect(findCourseClarificationOptions("neobstoječ", courses)).toEqual(courses);
    expect(findCourseClarificationOptions("neobstoječ", [])).toEqual([]);
  });

  it("zavrne več številk, vendar dovoli podvojeno konfiguracijo iste številke", () => {
    expect(resolveNamedCourseReference("ribjemu", [
      { courseNumber: 2, courseName: "Ribji hod" },
      { courseNumber: 2, courseName: "Ribji hod" },
    ])).toBe(2);
    expect(resolveNamedCourseReference("ribjemu", [
      { courseNumber: 2, courseName: "Ribji hod" },
      { courseNumber: 3, courseName: "Ribji hod" },
    ])).toBe("ambiguous");
  });

  it("course assignment is a closed server action, not a dialog handoff", () => {
    expect(PosAgentToolSchema.safeParse({
      odgovor: "V redu", action: "assign_course", narociloId: 1, postavkaId: 2, courseNumber: 2,
    }).success).toBe(true);
    expect(PosAgentToolSchema.safeParse({
      odgovor: "V redu", action: "assign_course", narociloId: 1, postavkaId: 2, courseNumber: 100,
    }).success).toBe(false);
    expect(PosAgentToolSchema.safeParse({
      odgovor: "V redu", action: "assign_courses", narociloId: 1,
      assignments: [{ postavkaId: 2, courseNumber: 1, naziv: "Juha" }, { postavkaId: 3, courseNumber: 2, naziv: "Zrezek" }],
    }).success).toBe(true);
  });

  it("deterministically resolves multiple dishes into one closed course action", async () => {
    const result = await resolveAgentAction("juho in solato na prvi hod; zrezek na drugi", 7, 1, {
      getOrder: async () => ({
        id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null, naslovDostave: null, skupaj: 12,
        postavke: [
          { id: 1, artikelId: 1, naziv: "Juho", kolicina: 1, skupaj: 3, opomba: null, parentPostavkaId: null, racunId: null },
          { id: 2, artikelId: 2, naziv: "Solato", kolicina: 1, skupaj: 3, opomba: null, parentPostavkaId: null, racunId: null },
          { id: 3, artikelId: 3, naziv: "Zrezek", kolicina: 1, skupaj: 6, opomba: null, parentPostavkaId: null, racunId: null },
        ],
      }),
    });
    expect(result).toMatchObject({ action: "assign_courses", assignments: [
      { postavkaId: 1, courseNumber: 1 }, { postavkaId: 2, courseNumber: 1 }, { postavkaId: 3, courseNumber: 2 },
    ] });

    const namedResult = await resolveAgentAction("vino k ribjemu hodu, zrezek na drugi", 7, 1, {
      getOrder: async () => ({
        id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null, naslovDostave: null, skupaj: 12,
        postavke: [
          { id: 4, artikelId: 4, naziv: "Vino", kolicina: 1, skupaj: 4, opomba: null, parentPostavkaId: null, racunId: null },
          { id: 5, artikelId: 5, naziv: "Zrezek", kolicina: 1, skupaj: 8, opomba: null, parentPostavkaId: null, racunId: null },
        ],
      }),
      loadCourseReferences: async () => [{ courseNumber: 3, courseName: "Ribji hod" }],
    });
    expect(namedResult).toMatchObject({ action: "assign_courses", assignments: [
      { postavkaId: 4, courseNumber: 3 }, { postavkaId: 5, courseNumber: 2 },
    ] });
  });

  it("returns precise no-action explanations for invalid multiple assignments", async () => {
    const order = async () => ({
      id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null, naslovDostave: null, skupaj: 12,
      postavke: [
        { id: 1, artikelId: 1, naziv: "Juho", kolicina: 1, skupaj: 3, opomba: null, parentPostavkaId: null, racunId: null },
        { id: 2, artikelId: 2, naziv: "Juho", kolicina: 1, skupaj: 3, opomba: null, parentPostavkaId: null, racunId: null },
        { id: 3, artikelId: 3, naziv: "Vino", kolicina: 1, skupaj: 6, opomba: null, parentPostavkaId: null, racunId: null },
      ],
    });
    const uniqueOrder = async () => ({
      id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null, naslovDostave: null, skupaj: 6,
      postavke: [
        { id: 3, artikelId: 3, naziv: "Vino", kolicina: 1, skupaj: 6, opomba: null, parentPostavkaId: null, racunId: null },
      ],
    });
    await expect(resolveAgentAction("juho na prvi hod, vino na drugi", 7, 1, { getOrder: order }))
      .resolves.toMatchObject({ action: "explain", odgovor: expect.stringContaining('"juho"') });
    await expect(resolveAgentAction("vino k ribjemu hodu, vino na drugi", 7, 1, {
      getOrder: uniqueOrder, loadCourseReferences: async () => [
        { courseNumber: 1, courseName: "Ribji hod" }, { courseNumber: 2, courseName: "Ribji hod" },
      ],
    })).resolves.toMatchObject({ action: "explain", odgovor: expect.stringContaining("Ista postavka") });
    await expect(resolveAgentAction("vino na prvi hod, manjka na drugi", 7, 1, { getOrder: uniqueOrder }))
      .resolves.toMatchObject({ action: "explain", odgovor: expect.stringContaining('"manjka"') });
    await expect(resolveAgentAction("vino na prvi hod, vino na drugi", 7, 1, { getOrder: uniqueOrder }))
      .resolves.toMatchObject({ action: "explain", odgovor: expect.stringContaining('"Vino"') });
    for (const command of [
      "vino k ribjemu hodu, vino na prvi hod",
      "vino na prvi hod, vino k ribjemu hodu",
    ]) {
      const result = await resolveAgentAction(command, 7, 1, {
        getOrder: uniqueOrder,
        loadCourseReferences: async () => [
          { courseNumber: 1, courseName: "Ribji hod" },
          { courseNumber: 2, courseName: "Ribjemu hod" },
        ],
      });
      expect(result).toMatchObject({ action: "explain", odgovor: expect.stringContaining("Ista postavka") });
      expect(result).not.toHaveProperty("courseClarificationDraft");
    }
  });

  it("omeji pojasnjevalni paket na 29 ohranjenih in eno dvoumno dodelitev", async () => {
    const postavke = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      artikelId: index + 1,
      naziv: index === 29 ? "Vino" : `Jed ${index + 1}`,
      kolicina: 1,
      skupaj: 1,
      opomba: null,
      parentPostavkaId: null,
      racunId: null,
    }));
    const getOrder = async () => ({
      id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null,
      naslovDostave: null, skupaj: 30, postavke,
    });
    const references = [
      { courseNumber: 2, courseName: "Ribji hod" },
      { courseNumber: 3, courseName: "Ribjemu hod" },
    ];
    const allowedCommand = [
      ...postavke.slice(0, 29).map(item => `${item.naziv} na prvi hod`),
      "Vino k ribjemu hodu",
    ].join(", ");
    const allowed = await resolveAgentAction(allowedCommand, 7, 1, {
      getOrder,
      loadCourseReferences: async () => references,
    });
    expect(allowed).toMatchObject({
      action: "explain",
      courseClarificationDraft: {
        kind: "batch",
      },
    });
    if (!allowed || !("courseClarificationDraft" in allowed) || allowed.courseClarificationDraft.kind !== "batch") {
      throw new Error("Expected a batch course clarification draft");
    }
    expect(allowed.courseClarificationDraft.assignments).toHaveLength(29);

    const oversizedPostavke = [...postavke, {
      id: 31, artikelId: 31, naziv: "Dodatek", kolicina: 1, skupaj: 1, opomba: null,
      parentPostavkaId: null, racunId: null,
    }];
    const oversizedCommand = `${allowedCommand}, Dodatek na prvi hod`;
    const oversized = await resolveAgentAction(oversizedCommand, 7, 1, {
      getOrder: async () => ({ ...(await getOrder()), postavke: oversizedPostavke }),
      loadCourseReferences: async () => references,
    });
    expect(oversized).toMatchObject({ action: "explain", odgovor: expect.stringContaining("največ 30") });
    expect(oversized).not.toHaveProperty("courseClarificationDraft");
  });

  it("deterministically resolves a spoken course assignment without an LLM handoff", async () => {
    await expect(resolveAgentAction("glavno jed na drugi hod", 7, 1, {
      getOrder: async () => ({
        id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null, naslovDostave: null, skupaj: 12,
        postavke: [{ id: 9, artikelId: 2, naziv: "Glavna jed", kolicina: 1, skupaj: 12, opomba: null, parentPostavkaId: null, racunId: null }],
      }),
    })).resolves.toMatchObject({ action: "assign_course", postavkaId: 9, courseNumber: 2 });
  });

  it("assigns a named course only after an injected active-order lookup resolves one number", async () => {
    const result = await resolveAgentAction("daj vino k ribjemu hodu", 7, 1, {
      getOrder: async () => ({
        id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null, naslovDostave: null, skupaj: 12,
        postavke: [{ id: 9, artikelId: 2, naziv: "Vino", kolicina: 1, skupaj: 12, opomba: null, parentPostavkaId: null, racunId: null }],
      }),
      loadCourseReferences: async () => [{ courseNumber: 2, courseName: "Ribji hod" }],
    });
    expect(result).toEqual(expect.objectContaining({ action: "assign_course", postavkaId: 9, courseNumber: 2 }));
    expect(result).not.toHaveProperty("courseName");
  });

  it("does not assign a named course when active-order candidates are missing or ambiguous", async () => {
    const order = async () => ({
      id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null, naslovDostave: null, skupaj: 12,
      postavke: [{ id: 9, artikelId: 2, naziv: "Vino", kolicina: 1, skupaj: 12, opomba: null, parentPostavkaId: null, racunId: null }],
    });
    await expect(resolveAgentAction("daj vino k ribjemu hodu", 7, 1, {
      getOrder: order, loadCourseReferences: async () => [],
    })).resolves.toMatchObject({ action: "explain" });
    await expect(resolveAgentAction("daj vino k ribjemu hodu", 7, 1, {
      getOrder: order, loadCourseReferences: async () => [
        { courseNumber: 2, courseName: "Ribji hod" }, { courseNumber: 3, courseName: "Ribjemu hod" },
      ],
    })).resolves.toMatchObject({
      action: "explain",
      odgovor: expect.stringContaining("Ribji hod (2)"),
      courseClarificationDraft: {
        narociloId: 7,
        postavkaId: 9,
        options: [
          { courseNumber: 2, courseName: "Ribji hod" },
          { courseNumber: 3, courseName: "Ribjemu hod" },
        ],
      },
    });
  });

  it("zaporedno razjasni več ločenih ciljev z nespremenjenim podpisanim paketom", async () => {
    const order = {
      id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null,
      naslovDostave: null, skupaj: 18,
      postavke: ["Vino", "Juha", "Solata"].map((naziv, index) => ({
        id: 9 + index, artikelId: 2 + index, naziv, kolicina: 1, skupaj: 6,
        opomba: null, parentPostavkaId: null, racunId: null,
      })),
    };
    const fish = [{ courseNumber: 2, courseName: "Ribji hod" }, { courseNumber: 3, courseName: "Ribji posebni hod" }];
    const warm = [{ courseNumber: 4, courseName: "Topli hod" }, { courseNumber: 5, courseName: "Topli posebni hod" }];
    const references = [...fish, ...warm];
    const resolved = await resolveAgentAction("vino k ribjemu hodu, juha k toplemu hodu, solata na prvi hod", 7, 4, {
      getOrder: async () => order, loadCourseReferences: async () => references,
    });
    expect(resolved).toMatchObject({
      action: "explain", courseClarificationDraft: {
        assignments: [{ postavkaId: 11, courseNumber: 1 }],
        targets: [{ postavkaId: 9, options: fish }, { postavkaId: 10, options: warm }],
      },
    });
    const token = signCourseClarificationToken({
      enotaId: 4, actorNatakarId: 6, narociloId: 7,
      assignments: [{ postavkaId: 11, courseNumber: 1 }],
      targets: [{ postavkaId: 9, options: fish }, { postavkaId: 10, options: warm }],
      selections: [], orderFingerprint: fingerprintCourseClarificationOrder(order),
    }, "multi-secret", 1_000)!;
    const payload = verifyCourseClarificationToken(token, "multi-secret", 1_001)!;
    const input = { payload, command: "3", enotaId: 4, actorNatakarId: 6, requestedNarociloId: 7, order, currentReferences: references };
    expect(validateCourseClarificationContinuation({ ...input, command: "5" })).toEqual({ status: "invalid_selection" });
    const pending = validateCourseClarificationContinuation(input);
    expect(pending.status).toBe("pending");
    if (pending.status !== "pending") throw new Error("Expected pending selection");
    expect(pending).not.toHaveProperty("result");
    const nextToken = encodeCourseClarificationToken(pending.payload, "multi-secret")!;
    const next = verifyCourseClarificationToken(nextToken, "multi-secret", 1_002)!;
    expect(next).toMatchObject({ clarificationId: payload.clarificationId, expiresAt: payload.expiresAt, selections: [3] });
    expect(verifyCourseClarificationToken(`${nextToken}x`, "multi-secret", 1_002)).toBeNull();
    expect(verifyCourseClarificationToken(nextToken, "multi-secret", 121_001)).toBeNull();
    const finalInput = { ...input, payload: next, command: "4" };
    expect(validateCourseClarificationContinuation(finalInput)).toMatchObject({
      status: "ready", result: { action: "assign_courses", assignments: [
        { postavkaId: 11, courseNumber: 1 }, { postavkaId: 9, courseNumber: 3 }, { postavkaId: 10, courseNumber: 4 },
      ] },
    });
    for (const overrides of [
      { enotaId: 5 }, { actorNatakarId: 7 }, { requestedNarociloId: 8 },
      { order: { ...order, status: "placano" } },
      { order: { ...order, postavke: order.postavke.slice(1) } },
      { currentReferences: [...fish, { ...warm[0]!, courseName: "Preimenovan hod" }, warm[1]!] },
      { currentReferences: [{ ...fish[0]!, courseName: "Spremenjen prejšnji hod" }, fish[1]!, ...warm] },
    ]) {
      expect(validateCourseClarificationContinuation({ ...finalInput, ...overrides })).toEqual({ status: "stale" });
    }
    expect(order.postavke.every(item => !("courseNumber" in item))).toBe(true);
  });

  it("pri paketnem ukazu ohrani razrešene dodelitve in ponudi možnosti samo za dvoumni hod", async () => {
    const order = {
      id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null,
      naslovDostave: null, skupaj: 18,
      postavke: [
        { id: 9, artikelId: 2, naziv: "Vino", kolicina: 1, skupaj: 6, opomba: null, parentPostavkaId: null, racunId: null },
        { id: 10, artikelId: 3, naziv: "Juha", kolicina: 1, skupaj: 12, opomba: null, parentPostavkaId: null, racunId: null },
      ],
    };
    const options = [
      { courseNumber: 2, courseName: "Ribji hod" },
      { courseNumber: 3, courseName: "Ribjemu hod" },
    ];
    const resolved = await resolveAgentAction("vino k ribjemu hodu, juha na prvi hod", 7, 4, {
      getOrder: async () => order,
      loadCourseReferences: async () => options,
    });
    expect(resolved).toMatchObject({
      action: "explain",
      courseClarificationDraft: {
        kind: "batch",
        narociloId: 7,
        targetPostavkaId: 9,
        assignments: [{ postavkaId: 10, courseNumber: 1 }],
        options,
      },
    });

    const token = signCourseClarificationToken({
      enotaId: 4,
      actorNatakarId: 12,
      narociloId: 7,
      targetPostavkaId: 9,
      assignments: [{ postavkaId: 10, courseNumber: 1 }],
      options,
      orderFingerprint: fingerprintCourseClarificationOrder(order),
    }, "batch-secret", 1_000)!;
    const payload = verifyCourseClarificationToken(token, "batch-secret", 1_001)!;
    expect(payload.v).toBe(2);
    expect(validateCourseClarificationContinuation({
      payload,
      command: "3",
      enotaId: 4,
      actorNatakarId: 12,
      requestedNarociloId: 7,
      order,
      currentReferences: options,
    })).toMatchObject({
      status: "ready",
      result: {
        action: "assign_courses",
        assignments: [
          { postavkaId: 10, courseNumber: 1, naziv: "Juha" },
          { postavkaId: 9, courseNumber: 3, naziv: "Vino" },
        ],
      },
    });
    expect(validateCourseClarificationContinuation({
      payload,
      command: "3",
      enotaId: 5,
      actorNatakarId: 12,
      requestedNarociloId: 7,
      order,
      currentReferences: options,
    })).toEqual({ status: "stale" });
    expect(validateCourseClarificationContinuation({
      payload,
      command: "3",
      enotaId: 4,
      actorNatakarId: 99,
      requestedNarociloId: 7,
      order,
      currentReferences: options,
    })).toEqual({ status: "stale" });
    expect(validateCourseClarificationContinuation({
      payload,
      command: "3",
      enotaId: 4,
      actorNatakarId: 12,
      requestedNarociloId: 7,
      order: { ...order, postavke: [{ ...order.postavke[0]!, kolicina: 2 }, order.postavke[1]!] },
      currentReferences: options,
    })).toEqual({ status: "stale" });
    expect(validateCourseClarificationContinuation({
      payload,
      command: "3",
      enotaId: 4,
      actorNatakarId: 12,
      requestedNarociloId: 7,
      order,
      currentReferences: [{ courseNumber: 2, courseName: "Preimenovan hod" }, options[1]!],
    })).toEqual({ status: "stale" });
  });

  it("podpisano pojasnilo sprejme le dovoljeno številko za isto sveže naročilo", () => {
    const order = {
      id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null,
      naslovDostave: null, skupaj: 12,
      postavke: [{
        id: 9, artikelId: 2, naziv: "Vino", kolicina: 1, skupaj: 12, opomba: null,
        parentPostavkaId: null, racunId: null,
      }],
    };
    const options = [
      { courseNumber: 2, courseName: "Ribji hod" },
      { courseNumber: 3, courseName: "Ribji posebni hod" },
    ];
    const secret = "test-course-clarification-secret";
    const token = signCourseClarificationToken({
      enotaId: 4,
      actorNatakarId: 12,
      narociloId: 7,
      postavkaId: 9,
      options,
      orderFingerprint: fingerprintCourseClarificationOrder(order),
    }, secret, 1_000);
    expect(token).toBeTruthy();
    const payload = verifyCourseClarificationToken(token!, secret, 1_001);
    expect(payload).not.toBeNull();
    expect(verifyCourseClarificationToken(`${token}x`, secret, 1_001)).toBeNull();

    expect(validateCourseClarificationContinuation({
      payload: payload!,
      command: "hod 3",
      enotaId: 4,
      actorNatakarId: 12,
      requestedNarociloId: 7,
      order,
      currentReferences: options,
    })).toMatchObject({
      status: "ready",
      result: { action: "assign_course", postavkaId: 9, courseNumber: 3 },
    });
    expect(validateCourseClarificationContinuation({
      payload: payload!,
      command: "4",
      enotaId: 4,
      actorNatakarId: 12,
      requestedNarociloId: 7,
      order,
      currentReferences: options,
    })).toEqual({ status: "invalid_selection" });
    expect(validateCourseClarificationContinuation({
      payload: payload!,
      command: "2",
      enotaId: 4,
      actorNatakarId: 99,
      requestedNarociloId: 7,
      order,
      currentReferences: options,
    })).toEqual({ status: "stale" });
  });

  it("pojasnilo varno razveljavi sprememba naročila ali razpoložljivih hodov", () => {
    const order = {
      id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null,
      naslovDostave: null, skupaj: 12,
      postavke: [{
        id: 9, artikelId: 2, naziv: "Vino", kolicina: 1, skupaj: 12, opomba: null,
        parentPostavkaId: null, racunId: null,
      }],
    };
    const options = [{ courseNumber: 2, courseName: "Ribji hod" }];
    const token = signCourseClarificationToken({
      enotaId: 4, actorNatakarId: 12, narociloId: 7, postavkaId: 9, options,
      orderFingerprint: fingerprintCourseClarificationOrder(order),
    }, "secret", 1_000)!;
    const payload = verifyCourseClarificationToken(token, "secret", 1_001)!;
    const base = {
      payload, command: "2", enotaId: 4, actorNatakarId: 12, requestedNarociloId: 7,
    };
    expect(validateCourseClarificationContinuation({
      ...base,
      order: { ...order, postavke: [{ ...order.postavke[0]!, kolicina: 2 }] },
      currentReferences: options,
    })).toEqual({ status: "stale" });
    expect(validateCourseClarificationContinuation({
      ...base,
      order,
      currentReferences: [{ courseNumber: 2, courseName: "Preimenovan hod" }],
    })).toEqual({ status: "stale" });
    expect(verifyCourseClarificationToken(token, "secret", 121_001)).toBeNull();
  });

  it.each([
    ["Ali je miza tri prosta?", 3],
    ["je miza 3 zasedena", 3],
    ["kakšno je stanje mize številka tri", 3],
  ])("razčleni vprašanje o stanju mize", (command, expected) => {
    expect(parseTableStatusQuestion(command)).toBe(expected);
  });

  it("prepusti splošno vprašanje varnemu modelu", async () => {
    await expect(resolveAgentAction("Kdaj se začne happy hour?", undefined, 1)).resolves.toBeNull();
  });

  it("za nepopolno mutacijo ohrani pojasnilo o artiklu", async () => {
    await expect(resolveAgentAction("dodaj", undefined, 1)).resolves.toMatchObject({ action: "explain" });
  });

  it("fallback schema zavrne operativne mutacije", () => {
    expect(PosAgentFallbackSchema.safeParse({ odgovor: "ok", action: "add_item", narociloId: 1 }).success).toBe(false);
    expect(PosAgentFallbackSchema.safeParse({ odgovor: "ok", action: "explain" }).success).toBe(true);
    expect(PosAgentFallbackSchema.safeParse({ odgovor: "odpri", action: "navigate", navigateTo: "/zaloge" }).success).toBe(true);
  });

  it("odstrani strukturirane kontaktne podatke iz modelskega prompta", () => {
    const redacted = redactAgentPromptText("Ana Novak, stranka ana novak, ana@example.com, +386 40 123 456, https://example.com, Cesta svobode 12");
    expect(redacted).not.toMatch(/Ana Novak|ana novak|example\.com|386|123 456|Cesta svobode 12/i);
    expect(redacted).toContain("[E-POŠTA]");
  });

  it.each(["odpri blagajno", "pojdi na blagajno"])(
    "resolver da operativni blagajni prednost pred nastavitvami: %s", async command => {
      const result = await resolveAgentAction(command, 7, 1, {
        getOrder: async () => ({
          id: 7, nacin: "miza", status: "odprto", miza: 3, strankaIme: null, telefon: null,
          naslovDostave: null, skupaj: 5,
          postavke: [{ id: 1, artikelId: 2, naziv: "Kava", kolicina: 1, skupaj: 5, opomba: null, parentPostavkaId: null, racunId: null }],
        }),
      });
      expect(result).toMatchObject({ action: "prepare_checkout", narociloId: 7, navigateTo: "/blagajna?narocilo=7" });
    },
  );

  it("eksplicitne FURS nastavitve blagajn ostanejo nastavitve", async () => {
    await expect(resolveAgentAction("odpri FURS nastavitve blagajn", 7, 1, {
      getOrder: async () => { throw new Error("checkout lookup must not run"); },
    })).resolves.toMatchObject({ action: "navigate" });
  });

  it.each(["pokaži status mize 3", "prikaži stanje mize tri", "ali je miza tri prosta"])(
    "resolver preveri stanje mize pred generično navigacijo: %s", async command => {
      await expect(resolveAgentAction(command, undefined, 4, {
        getTableStatus: async (number, unit) => ({
          action: "explain", odgovor: `Miza ${number} v enoti ${unit} je prosta.`,
        }),
      })).resolves.toEqual({ action: "explain", odgovor: "Miza 3 v enoti 4 je prosta." });
    },
  );

  it("odpiranje nastavitev miz ostane navigacija nastavitev", async () => {
    await expect(resolveAgentAction("odpri nastavitve miz", undefined, 1)).resolves.toMatchObject({ action: "navigate" });
  });

  it.each([["enajst", 11], ["dvaindvajset", 22], ["enaindvajset", 21], ["99", 99]])(
    "razčleni slovensko številko mize %s", (value, expected) => {
      expect(parseSlovenianTableNumber(value)).toBe(expected);
    },
  );

  it("uporabi enaka prikazna pravila za prosto, zasedeno in rezervirano mizo", () => {
    const now = Date.now();
    expect(resolveAgentTableDisplayState({ persistedStatus: "prosta", openOrderCount: 0, reservationStarts: [], now })).toBe("prosta");
    expect(resolveAgentTableDisplayState({ persistedStatus: "prosta", openOrderCount: 1, reservationStarts: [], now })).toBe("zasedena");
    expect(resolveAgentTableDisplayState({ persistedStatus: "prosta", openOrderCount: 0, reservationStarts: [new Date(now + 60_000)], now })).toBe("rezervirana");
  });

  it("splošnemu modelu dovoli samo obstoječe statične POS poti", () => {
    expect(isSafeAgentStaticNavigation("/izmene")).toBe(true);
    expect(isSafeAgentStaticNavigation("/zaloge")).toBe(true);
    expect(isSafeAgentStaticNavigation("/narocilo/123")).toBe(false);
    expect(isSafeAgentStaticNavigation("/?odpriMizo=1")).toBe(false);
    expect(isSafeAgentStaticNavigation("/neobstojeca-pot")).toBe(false);
  });

  it("prepozna zahtevo za ponovitev zadnjega ukaza", () => {
    expect(isRepeatLastAgentCommand("ponovi zadnji ukaz")).toBe(true);
    expect(isRepeatLastAgentCommand("Ponovi ukaz.")).toBe(true);
    expect(isRepeatLastAgentCommand("ponovi naročilo")).toBe(false);
  });

  it.each([
    ["odpri izmeno", true],
    ["odpri mi izmeno", true],
    ["odpri novo izmeno na moje ime", true],
    ["odpri izmeno zame", true],
    ["odpri izmeno na ime", true],
    ["odpri izmeno za Ano", false],
    ["zapri izmeno", false],
  ])("prepozna samo varen ukaz za lastno izmeno", (command, expected) => {
    expect(isOpenOwnShiftCommand(command)).toBe(expected);
  });

  it("ponovi zadnje strukturirano odpiranje mize brez shranjevanja prepisa", () => {
    expect(findRepeatableOpenTableNumber([
      { action: "explain", outcome: "success", metadata: {} },
      { action: "navigate", outcome: "success", metadata: { intent: "open_table_order", tableNumber: 1 } },
    ])).toBe(1);
  });

  it("po ponastavitvi ne ponavlja starejših ukazov", () => {
    expect(findRepeatableOpenTableNumber([
      { action: "reset_memory", outcome: "success", metadata: {} },
      { action: "navigate", outcome: "success", metadata: { intent: "open_table_order", tableNumber: 1 } },
    ])).toBeNull();
  });
});