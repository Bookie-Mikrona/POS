export function requiresClassicNormativ(
  mealType: "ala_carte" | "prepared" | "composite",
  isMulticourseMenu: boolean,
): boolean {
  return mealType === "composite" && !isMulticourseMenu;
}

export type EditableMulticourseCourse = {
  courseName: string;
  informational: boolean;
  wineRequired: boolean;
  allowedFoodArtikelIds: number[];
  allowedWineArtikelIds: number[];
};

export function validateMulticourseMenu(
  selectionMode: "fixed" | "choose",
  selectionCount: number,
  courses: readonly EditableMulticourseCourse[],
): string | null {
  if (courses.length < 2 || courses.length > 20) return "Meni mora imeti od 2 do 20 hodov.";
  const regularCourses = courses.filter(course => !course.informational);
  if (!regularCourses.length) return "Meni mora imeti vsaj en običajen hod.";
  if (selectionMode === "choose" && (!Number.isInteger(selectionCount) || selectionCount < 1 || selectionCount > regularCourses.length)) {
    return "Število izbranih hodov mora biti med 1 in številom običajnih hodov.";
  }
  for (let index = 0; index < courses.length; index++) {
    const course = courses[index]!;
    if (!course.courseName.trim()) return `Vnesite ime za ${index + 1}. hod.`;
    if (!course.allowedFoodArtikelIds.length) return `Za ${course.courseName.trim()} izberite vsaj eno jed.`;
    if (course.informational && course.wineRequired) return `Informativni hod »${course.courseName.trim()}« ne more zahtevati vina.`;
    if (course.wineRequired && !course.allowedWineArtikelIds.length) return `Za ${course.courseName.trim()} izberite vsaj eno vino.`;
  }
  return null;
}