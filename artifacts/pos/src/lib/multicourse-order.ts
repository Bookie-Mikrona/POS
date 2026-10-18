export type MulticourseCourse = {
  courseNumber: number;
  /** Human readable title supplied by the generic multicourse API. */
  courseName?: string;
  allowedFoodArtikelIds: readonly number[];
  allowedWineArtikelIds: readonly number[];
  /** Defaults to true for configurations created before optional wine existed. */
  wineRequired?: boolean;
  /** An automatically materialised course which staff do not select. */
  informational?: boolean;
};

export type MulticourseSelection = {
  courseNumber: number;
  foodArtikelId?: number;
  wineArtikelId?: number;
};

export type MulticourseMenuSelection = {
  /** Generic API field. Legacy menus only contain `izbor`. */
  selectionMode?: "fixed" | "choose";
  /** Required only in choose mode. */
  selectionCount?: number | null;
  /** Kept to read existing fixed-four / choose-three configurations. */
  izbor?: "fixed_four" | "choose_three";
};

export type MulticourseDisplayRow = {
  id: number;
  ime: string;
  kolicina: number;
  cenaKos: number;
  skupaj: number;
  pairingGroupId?: string | null;
  courseNumber?: number | null;
};

export type MulticourseBundleDisplayRow<T> = T & {
  isMulticourseBundle?: boolean;
};

export function isInternalMulticourseComponent(row: {
  pairingGroupId?: string | null;
  courseNumber?: number | null;
}): boolean {
  return row.pairingGroupId != null && row.courseNumber != null && !isDailyLunchRow(row);
}

/** Dnevno kosilo: vse vrstice hodov so vidne na naročilu (cena kosila je na glavni jedi). */
export function isDailyLunchRow(row: { pairingGroupId?: string | null }): boolean {
  return row.pairingGroupId?.startsWith("daily-lunch:") === true;
}

/** Združi DDV-razdeljene komercialne vrstice paketa samo za prikaz v POS-u. */
export function groupMulticourseOrderRows<T extends MulticourseDisplayRow>(
  rows: readonly T[],
): MulticourseBundleDisplayRow<T>[] {
  const result: MulticourseBundleDisplayRow<T>[] = [];
  const groupIndexes = new Map<string, number>();

  for (const row of rows) {
    if (isInternalMulticourseComponent(row)) continue;
    if (!row.pairingGroupId || isDailyLunchRow(row)) {
      result.push(row);
      continue;
    }

    const existingIndex = groupIndexes.get(row.pairingGroupId);
    if (existingIndex == null) {
      groupIndexes.set(row.pairingGroupId, result.length);
      result.push({
        ...row,
        ime: row.ime.replace(/\s+[–-]\s+(hrana|vinska spremljava)$/i, ""),
        isMulticourseBundle: true,
      });
      continue;
    }

    const existing = result[existingIndex];
    result[existingIndex] = {
      ...existing,
      cenaKos: existing.cenaKos + row.cenaKos,
      skupaj: existing.skupaj + row.skupaj,
      isMulticourseBundle: true,
    };
  }
  return result;
}

export function multicourseSelectionRequirements(
  menu: MulticourseMenuSelection | "fixed_four" | "choose_three",
  courses: readonly MulticourseCourse[],
): { mode: "fixed" | "choose"; count: number } {
  const normalizedMenu = typeof menu === "string" ? { izbor: menu } : menu;
  const mode = normalizedMenu.selectionMode ?? (normalizedMenu.izbor === "choose_three" ? "choose" : "fixed");
  const selectableCount = courses.filter(course => !course.informational).length;
  return {
    mode,
    count: mode === "fixed" ? selectableCount : (normalizedMenu.selectionCount ?? 3),
  };
}

/** Validates the staff selection before the atomic multicourse order request. */
export function validateMulticourseOrderSelection(
  menu: MulticourseMenuSelection | "fixed_four" | "choose_three",
  courses: MulticourseCourse[],
  selections: MulticourseSelection[],
): string | null {
  const { count: expected } = multicourseSelectionRequirements(menu, courses);
  if (selections.length !== expected) return `Izberite natanko ${expected} hode.`;

  const configured = new Map(courses.map(course => [course.courseNumber, course]));
  if (new Set(selections.map(selection => selection.courseNumber)).size !== selections.length
    || selections.some(selection => !configured.has(selection.courseNumber)
      || configured.get(selection.courseNumber)?.informational)) {
    return "Izbira hodov ni veljavna.";
  }

  if (selections.some(selection => !selection.foodArtikelId
    || !configured.get(selection.courseNumber)?.allowedFoodArtikelIds.includes(selection.foodArtikelId))) {
    return "Za vsak izbran hod izberite dovoljeno jed.";
  }

  if (selections.some(selection => {
    const course = configured.get(selection.courseNumber);
    return !course || (course.wineRequired !== false && (!selection.wineArtikelId
      || !course.allowedWineArtikelIds.includes(selection.wineArtikelId)));
  })) {
    return "Za vsak izbran hod izberite dovoljeno vino.";
  }
  if (selections.some(selection => {
    const course = configured.get(selection.courseNumber);
    return course?.wineRequired === false && selection.wineArtikelId != null
      && !course.allowedWineArtikelIds.includes(selection.wineArtikelId);
  })) {
    return "Izbrano vino ni dovoljeno za ta hod.";
  }
  return null;
}