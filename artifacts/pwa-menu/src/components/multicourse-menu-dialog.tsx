import React, { useEffect, useMemo, useState } from 'react';
import { trackEvent } from '@/lib/analytics';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { type PublicMenuArticle, type PublicMulticourseMenu } from '@/hooks/use-public-api';
import { useCart } from '@/lib/cart-context';
import { multicourseSelectionRequirements, validateMulticourseSelection } from '@/lib/multicourse';

type Props = {
  menu: PublicMulticourseMenu | null;
  article: PublicMenuArticle | null;
  articles: PublicMenuArticle[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MulticourseMenuDialog({ menu, article, articles, open, onOpenChange }: Props) {
  const { addItem } = useCart();
  const [selectedCourses, setSelectedCourses] = useState<number[]>([]);
  const [foods, setFoods] = useState<Record<number, number>>({});
  const [wines, setWines] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const articlesById = useMemo(() => new Map(articles.map((item) => [item.id, item])), [articles]);

  useEffect(() => {
    if (!open || !menu) return;
    const { mode, selectableCourses } = multicourseSelectionRequirements(menu, menu.courses);
    const required = mode === 'fixed' ? selectableCourses : [];
    setSelectedCourses(required.map((course) => course.courseNumber));
    setFoods({});
    setWines({});
    setError(null);
  }, [open, menu]);

  if (!menu || !article) return null;
  const { mode, count, selectableCourses } = multicourseSelectionRequirements(menu, menu.courses);
  const informationalCourses = menu.courses.filter((course) => course.informational);
  const toggleCourse = (courseNumber: number) => {
    if (mode === 'fixed') return;
    setSelectedCourses((current) => current.includes(courseNumber)
      ? current.filter((value) => value !== courseNumber)
      : current.length < count ? [...current, courseNumber] : current);
  };
  const submit = () => {
    const chosen = selectableCourses.filter((course) => selectedCourses.includes(course.courseNumber));
    const selectionError = validateMulticourseSelection(
      menu,
      menu.courses,
      chosen.map((course) => ({
        courseNumber: course.courseNumber,
        foodArtikelId: foods[course.courseNumber],
          wineArtikelId: course.wineRequired !== false ? wines[course.courseNumber] : null,
      })),
    );
    if (selectionError) {
      setError(selectionError);
      return;
    }
    addItem({
      artikel: article, kolicina: 1, modifikatorji: [],
      multicourseSelection: {
        menuArtikelId: menu.menuArtikelId,
        courses: chosen.map((course) => ({
          courseNumber: course.courseNumber,
          courseName: course.courseName || `${course.courseNumber}. hod`,
          foodArtikelId: foods[course.courseNumber]!,
          wineArtikelId: course.wineRequired !== false ? wines[course.courseNumber]! : null,
        })),
        informationalCourseNames: informationalCourses.map((course) => course.courseName || `${course.courseNumber}. hod`),
      },
    });
    trackEvent("multicourse_configured", {
      selection_mode: mode,
      selected_course_count: chosen.length,
      has_wine: chosen.some(course => course.wineRequired !== false),
      has_informational_courses: informationalCourses.length > 0,
    });
    onOpenChange(false);
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{article.naziv}</DialogTitle>
        <DialogDescription>
          {mode === 'fixed'
            ? `Vseh ${count} hodov je vključenih v določenem vrstnem redu.`
            : `Izberite natanko ${count} od ${selectableCourses.length} hodov.`}
          {' '}Za vsak izbran hod izberite eno jed{selectableCourses.some((course) => course.wineRequired !== false) ? ' in vino (1 dl), kadar je zahtevano.' : '.'}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {menu.courses.map((course) => {
          const selected = selectedCourses.includes(course.courseNumber);
          const foodsForCourse = course.allowedFoodArtikelIds.map((id) => articlesById.get(id)).filter((food): food is PublicMenuArticle => Boolean(food));
          const winesForCourse = course.allowedWineArtikelIds.map((id) => articlesById.get(id)).filter((wine): wine is PublicMenuArticle => Boolean(wine));
          return <fieldset key={course.courseNumber} className="rounded-lg border p-3">
            <label className="flex gap-2 font-medium">
              {!course.informational && <input type="checkbox" checked={selected} disabled={mode === 'fixed'} onChange={() => toggleCourse(course.courseNumber)} />}
              {course.courseName || `${course.courseNumber}. hod`}
            </label>
            {course.informational
              ? <p className="mt-2 text-sm text-muted-foreground">Samodejno vključeno v meni.</p>
              : selected && <div className="mt-3 space-y-3">
              <label className="block text-sm">Jed
                <select className="mt-1 w-full rounded-md border bg-background p-2" value={foods[course.courseNumber] ?? ''} onChange={(event) => setFoods((current) => ({ ...current, [course.courseNumber]: Number(event.target.value) }))}>
                  <option value="">Izberite jed</option>
                  {foodsForCourse.map((food) => <option key={food.id} value={food.id}>{food.naziv}</option>)}
                </select>
              </label>
              {course.wineRequired !== false && <label className="block text-sm">Vino (1 dl)
                <select className="mt-1 w-full rounded-md border bg-background p-2" value={wines[course.courseNumber] ?? ''} onChange={(event) => setWines((current) => ({ ...current, [course.courseNumber]: Number(event.target.value) }))}>
                  <option value="">Izberite vino</option>
                  {winesForCourse.map((wine) => <option key={wine.id} value={wine.id}>{wine.naziv} · 1 dl</option>)}
                </select>
              </label>}
            </div>}
          </fieldset>;
        })}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button onClick={submit} data-testid="button-add-multicourse-menu">Dodaj meni v košarico</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}