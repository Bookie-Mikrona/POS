export type MulticourseChoice = {
  courseNumber: number;
  foodArtikelId?: number;
  wineArtikelId?: number | null;
};

export type MulticourseCourse = {
  courseNumber: number;
  courseName?: string | null;
  allowedFoodArtikelIds: number[];
  allowedWineArtikelIds: number[];
  wineRequired?: boolean | null;
  informational?: boolean | null;
};

export type MulticourseSelectionConfig = {
  izbor?: 'fixed_four' | 'choose_three';
  selectionMode?: 'fixed' | 'choose' | null;
  selectionCount?: number | null;
};

export function multicourseSelectionRequirements(
  config: MulticourseSelectionConfig | 'fixed_four' | 'choose_three',
  courses: MulticourseCourse[],
): { mode: 'fixed' | 'choose'; count: number; selectableCourses: MulticourseCourse[] } {
  const selectableCourses = courses.filter((course) => !course.informational);
  const normalized = typeof config === 'string' ? { izbor: config } : config;
  // Missing generic fields are an intentional legacy fallback.
  const mode = normalized.selectionMode ?? (normalized.izbor === 'choose_three' ? 'choose' : 'fixed');
  const count = mode === 'fixed' ? selectableCourses.length : (normalized.selectionCount ?? 3);
  return { mode, count, selectableCourses };
}

/** Returns a user-facing error, or null when the configured selection is valid. */
export function validateMulticourseSelection(
  config: MulticourseSelectionConfig | 'fixed_four' | 'choose_three',
  configuredCourses: MulticourseCourse[],
  choices: MulticourseChoice[],
): string | null {
  const { count: expected, selectableCourses } = multicourseSelectionRequirements(config, configuredCourses);
  if (configuredCourses.length < 2 || configuredCourses.length > 20
    || configuredCourses.some((course, index) => course.courseNumber !== index + 1)
    || expected < 1 || expected > selectableCourses.length) {
    return 'Konfiguracija večhodnega menija ni veljavna.';
  }
  if (choices.length !== expected) return `Izberite natanko ${expected} hode.`;
  if (new Set(choices.map((choice) => choice.courseNumber)).size !== choices.length
    || choices.some((choice) => !selectableCourses.some((course) => course.courseNumber === choice.courseNumber))) {
    return 'Izbira hodov ni veljavna.';
  }
  if (choices.some((choice) => !choice.foodArtikelId)) {
    return 'Za vsak izbran hod izberite dovoljeno jed.';
  }
  if (choices.some((choice) => {
    const course = selectableCourses.find((configured) => configured.courseNumber === choice.courseNumber)!;
    // wineRequired was implicit in the legacy contract.
    return course.wineRequired !== false && !choice.wineArtikelId;
  })) {
    return 'Za vsak izbran hod izberite dovoljeno vino (1 dl).';
  }
  if (choices.some((choice) => {
    const course = selectableCourses.find((configured) => configured.courseNumber === choice.courseNumber)!;
    return !course.allowedFoodArtikelIds.includes(choice.foodArtikelId!)
      || (course.wineRequired !== false && !course.allowedWineArtikelIds.includes(choice.wineArtikelId!))
      || (course.wineRequired === false && choice.wineArtikelId != null
        && !course.allowedWineArtikelIds.includes(choice.wineArtikelId));
  })) {
    return 'Izbrana jed ali vino za hod ni dovoljena.';
  }
  return null;
}