import { describe, expect, it } from 'vitest';
import { validateMulticourseSelection } from './multicourse';

describe('večhodni meni', () => {
  const courses = [1, 2, 3, 4].map((courseNumber) => ({
    courseNumber,
    allowedFoodArtikelIds: [courseNumber * 10],
    allowedWineArtikelIds: [courseNumber * 100],
  }));

  it('zahteva vse štiri fiksne hode, jed in vino za vsakega', () => {
    expect(validateMulticourseSelection({ izbor: 'fixed_four' }, courses, [
      { courseNumber: 1, foodArtikelId: 10, wineArtikelId: 100 }, { courseNumber: 2, foodArtikelId: 20, wineArtikelId: 200 },
      { courseNumber: 3, foodArtikelId: 30, wineArtikelId: 300 },
    ])).toMatch('4');
    expect(validateMulticourseSelection({ izbor: 'fixed_four' }, courses, [
      { courseNumber: 1, foodArtikelId: 10, wineArtikelId: 100 }, { courseNumber: 2, foodArtikelId: 20, wineArtikelId: 200 },
      { courseNumber: 3, foodArtikelId: 30, wineArtikelId: 300 }, { courseNumber: 4, foodArtikelId: 40 },
    ])).toMatch('vino');
    expect(validateMulticourseSelection({ izbor: 'fixed_four' }, courses, [
      { courseNumber: 1, foodArtikelId: 10, wineArtikelId: 100 }, { courseNumber: 2, foodArtikelId: 20, wineArtikelId: 200 },
      { courseNumber: 3, foodArtikelId: 30, wineArtikelId: 300 }, { courseNumber: 4, wineArtikelId: 400 },
    ])).toMatch('jed');
  });

  it('sprejme natanko tri različne dovoljene hode', () => {
    expect(validateMulticourseSelection({ izbor: 'choose_three' }, courses, [
      { courseNumber: 1, foodArtikelId: 10, wineArtikelId: 100 }, { courseNumber: 3, foodArtikelId: 30, wineArtikelId: 300 },
      { courseNumber: 4, foodArtikelId: 40, wineArtikelId: 400 },
    ])).toBeNull();
    expect(validateMulticourseSelection({ izbor: 'choose_three' }, courses, [
      { courseNumber: 1, foodArtikelId: 10, wineArtikelId: 100 }, { courseNumber: 1, foodArtikelId: 10, wineArtikelId: 100 },
      { courseNumber: 3, foodArtikelId: 30, wineArtikelId: 300 },
    ])).toMatch('ni veljavna');
  });

  it('zavrne jed ali vino, ki ni na dovoljenem seznamu hoda', () => {
    expect(validateMulticourseSelection({ izbor: 'choose_three' }, courses, [
      { courseNumber: 1, foodArtikelId: 99, wineArtikelId: 100 },
      { courseNumber: 2, foodArtikelId: 20, wineArtikelId: 200 },
      { courseNumber: 3, foodArtikelId: 30, wineArtikelId: 300 },
    ])).toMatch('ni dovoljena');
  });

  it('supports arbitrary choose-N menus and excludes informational courses from choices', () => {
    const genericCourses = [1, 2, 3, 4, 5].map((courseNumber) => ({
      courseNumber,
      courseName: `Hod ${courseNumber}`,
      allowedFoodArtikelIds: [courseNumber * 10],
      allowedWineArtikelIds: [courseNumber * 100],
      wineRequired: courseNumber !== 2,
      informational: courseNumber === 5,
    }));
    expect(validateMulticourseSelection({ selectionMode: 'choose', selectionCount: 3 }, genericCourses, [
      { courseNumber: 1, foodArtikelId: 10, wineArtikelId: 100 },
      { courseNumber: 2, foodArtikelId: 20, wineArtikelId: null },
      { courseNumber: 3, foodArtikelId: 30, wineArtikelId: 300 },
    ])).toBeNull();
    expect(validateMulticourseSelection({ selectionMode: 'choose', selectionCount: 3 }, genericCourses, [
      { courseNumber: 1, foodArtikelId: 10, wineArtikelId: 100 },
      { courseNumber: 2, foodArtikelId: 20, wineArtikelId: null },
      { courseNumber: 5, foodArtikelId: 50, wineArtikelId: 500 },
    ])).toMatch('ni veljavna');
  });

  it('does not require wine for a no-wine course but still allowlists it when supplied', () => {
    const noWine = [{ courseNumber: 1, allowedFoodArtikelIds: [10], allowedWineArtikelIds: [100], wineRequired: false },
      { courseNumber: 2, allowedFoodArtikelIds: [20], allowedWineArtikelIds: [], wineRequired: false }];
    expect(validateMulticourseSelection({ selectionMode: 'fixed' }, noWine, [
      { courseNumber: 1, foodArtikelId: 10, wineArtikelId: null },
      { courseNumber: 2, foodArtikelId: 20, wineArtikelId: null },
    ])).toBeNull();
    expect(validateMulticourseSelection({ selectionMode: 'fixed' }, noWine, [
      { courseNumber: 1, foodArtikelId: 10, wineArtikelId: 101 },
      { courseNumber: 2, foodArtikelId: 20, wineArtikelId: null },
    ])).toMatch('ni dovoljena');
  });
});