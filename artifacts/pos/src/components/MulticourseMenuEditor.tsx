import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { type EditableMulticourseCourse, validateMulticourseMenu } from "@/lib/multicourse-menu-validation";

type ArticleOption = {
  id: number;
  ime: string;
  kategorijaId?: number | null;
  kategorijaIme?: string | null;
  prodajniArtikel?: boolean | null;
  nabavniArtikel?: boolean | null;
  mealType?: "ala_carte" | "prepared" | "composite" | null;
  taxCategory?: string | null;
};
type StoredCourse = EditableMulticourseCourse & { courseNumber: number };
type StoredMenu = { id: number; menuArtikelId: number; izbor?: "fixed_four" | "choose_three"; selectionMode?: "fixed" | "choose"; selectionCount?: number | null; foodPricePercent?: string | number; aktivno: boolean; courses: StoredCourse[] };

const emptyCourse = (number: number): EditableMulticourseCourse => ({
  courseName: `${number}. hod`, informational: false, wineRequired: true, allowedFoodArtikelIds: [], allowedWineArtikelIds: [],
});

function MultiSelect({ label, selected, articles, onChange }: { label: string; selected: number[]; articles: ArticleOption[]; onChange: (ids: number[]) => void }) {
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]);
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><div className="max-h-28 overflow-y-auto rounded border p-2 grid gap-1 sm:grid-cols-2">
    {articles.map(article => <label key={article.id} className="flex gap-2 text-xs items-center"><Checkbox checked={selected.includes(article.id)} onCheckedChange={() => toggle(article.id)} />{article.ime}</label>)}
  </div></div>;
}

/** Editor is deliberately separate from Menu's article form: its API is menu-wrapper scoped. */
export function MulticourseMenuEditor({ menuArtikelId, articles, onSaved }: { menuArtikelId: number; articles: ArticleOption[]; onSaved?: () => void }) {
  const queryClient = useQueryClient();
  const [courses, setCourses] = useState<EditableMulticourseCourse[]>([emptyCourse(1), emptyCourse(2)]);
  const [selectionMode, setSelectionMode] = useState<"fixed" | "choose">("fixed");
  const [selectionCount, setSelectionCount] = useState(2);
  const [foodPricePercent, setFoodPricePercent] = useState(100);
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: menus = [], isLoading } = useQuery({ queryKey: ["multicourse-menus"], queryFn: () => customFetch<StoredMenu[]>("/api/multicourse-menus") });
  const existing = menus.find(menu => menu.menuArtikelId === menuArtikelId);
  useEffect(() => {
    if (!existing) return;
    setCourses(existing.courses.sort((a, b) => a.courseNumber - b.courseNumber).map(({ courseName, informational, wineRequired, allowedFoodArtikelIds, allowedWineArtikelIds }) => ({
      courseName, informational: informational === true, wineRequired: informational ? false : wineRequired !== false, allowedFoodArtikelIds, allowedWineArtikelIds,
    })));
    const mode = existing.selectionMode ?? (existing.izbor === "choose_three" ? "choose" : "fixed");
    setSelectionMode(mode); setSelectionCount(mode === "choose" ? (existing.selectionCount ?? 3) : 0);
    setFoodPricePercent(Number(existing.foodPricePercent ?? 100)); setActive(existing.aktivno);
  }, [existing?.id]); // Load once per wrapper, without overwriting edits on refetch.
  const save = useMutation({
    mutationFn: () => {
      const validation = validateMulticourseMenu(selectionMode, selectionCount, courses);
      if (validation) throw new Error(validation);
      if (!Number.isFinite(foodPricePercent) || foodPricePercent < 0 || foodPricePercent > 100) throw new Error("Delež hrane mora biti med 0 in 100 %.");
      const data = { menuArtikelId, aktivno: active, selectionMode, selectionCount: selectionMode === "choose" ? selectionCount : null, foodPricePercent, courses: courses.map((course, index) => ({
        ...course, courseNumber: index + 1, foodArtikelId: course.allowedFoodArtikelIds[0],
        wineRequired: course.informational ? false : course.wineRequired,
      })) };
      return customFetch(existing ? `/api/multicourse-menus/${existing.id}` : "/api/multicourse-menus", { method: existing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    },
    onSuccess: () => { setError(null); queryClient.invalidateQueries({ queryKey: ["multicourse-menus"] }); onSaved?.(); },
    onError: (err: Error) => setError(err.message || "Konfiguracije ni bilo mogoče shraniti."),
  });
  const updateCourse = (index: number, patch: Partial<EditableMulticourseCourse>) => setCourses(current => current.map((course, i) => i === index ? { ...course, ...patch } : course));
  const move = (index: number, direction: -1 | 1) => setCourses(current => { const next = [...current]; [next[index]!, next[index + direction]!] = [next[index + direction]!, next[index]!]; return next; });
  const menuWrapperIds = new Set(menus.map(menu => menu.menuArtikelId));
  menuWrapperIds.add(menuArtikelId);
  const foodArticles = articles.filter(article =>
    !menuWrapperIds.has(article.id)
    && article.taxCategory === "food"
    && article.nabavniArtikel !== true
    && article.kategorijaIme?.toLocaleLowerCase("sl").includes("večhod") === true
  );
  const wineArticles = articles.filter(article =>
    !menuWrapperIds.has(article.id)
    && article.taxCategory === "alcoholic"
    && article.prodajniArtikel !== false,
  );
  return <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3" data-testid="multicourse-menu-editor">
    <div><h3 className="font-semibold">Večhodni meni</h3><p className="text-xs text-muted-foreground">Nastavite hode, ki jih osebje izbira ob naročilu tega artikla.</p></div>
    <div className="flex flex-wrap gap-4 items-center"><Label className="flex gap-2 items-center"><input type="radio" checked={selectionMode === "fixed"} onChange={() => setSelectionMode("fixed")} />Vsi hodi</Label><Label className="flex gap-2 items-center"><input type="radio" checked={selectionMode === "choose"} onChange={() => setSelectionMode("choose")} />Izberi N hodov</Label>
      {selectionMode === "choose" && <Input className="w-20" type="number" min={1} max={courses.filter(c => !c.informational).length} value={selectionCount} onChange={e => setSelectionCount(Number(e.target.value))} aria-label="Število izbranih hodov" />}
      <Label className="flex gap-2 items-center"><Checkbox checked={active} onCheckedChange={value => setActive(value === true)} />Aktiven</Label></div>
    <div className="grid gap-3 rounded border bg-background p-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor={`food-share-${menuArtikelId}`}>Delež hrane (%)</Label><Input id={`food-share-${menuArtikelId}`} type="number" min={0} max={100} step="0.01" value={foodPricePercent} onChange={e => setFoodPricePercent(Number(e.target.value))} /></div>
      <div className="space-y-1"><Label>Delež vinske spremljave</Label><div className="h-10 rounded-md border bg-muted px-3 py-2 text-sm">{Math.max(0, 100 - (Number.isFinite(foodPricePercent) ? foodPricePercent : 0)).toFixed(2)} %</div></div>
      <p className="text-xs text-muted-foreground sm:col-span-2">Bruto cena menija se na računu razdeli na hrano z 9,5 % DDV in vinsko spremljavo z 22 % DDV.</p>
    </div>
    {courses.map((course, index) => <div key={index} className="space-y-2 rounded border bg-background p-3"><div className="flex gap-2 items-center"><b>{index + 1}.</b><Input value={course.courseName} onChange={e => updateCourse(index, { courseName: e.target.value })} aria-label={`Ime ${index + 1}. hoda`} /><Button type="button" size="icon" variant="ghost" disabled={!index} onClick={() => move(index, -1)}><ChevronUp /></Button><Button type="button" size="icon" variant="ghost" disabled={index === courses.length - 1} onClick={() => move(index, 1)}><ChevronDown /></Button><Button type="button" size="icon" variant="ghost" disabled={courses.length <= 2} onClick={() => setCourses(courses.filter((_, i) => i !== index))}><Trash2 /></Button></div>
      <div className="flex gap-4"><Label className="flex gap-2 text-xs items-center"><Checkbox checked={course.informational} onCheckedChange={value => updateCourse(index, { informational: value === true, wineRequired: value === true ? false : course.wineRequired })} />Informativni hod</Label><Label className="flex gap-2 text-xs items-center"><Checkbox disabled={course.informational} checked={course.wineRequired} onCheckedChange={value => updateCourse(index, { wineRequired: value === true })} />Vino je obvezno</Label></div>
      <MultiSelect label="Dovoljene jedi" selected={course.allowedFoodArtikelIds} articles={foodArticles} onChange={ids => updateCourse(index, { allowedFoodArtikelIds: ids })} />
      <MultiSelect label="Dovoljena vina" selected={course.allowedWineArtikelIds} articles={wineArticles} onChange={ids => updateCourse(index, { allowedWineArtikelIds: ids })} />
    </div>)}
    <div className="flex items-center justify-between"><Button type="button" variant="outline" disabled={courses.length >= 20} onClick={() => setCourses([...courses, emptyCourse(courses.length + 1)])}><Plus className="mr-1 h-4 w-4" />Dodaj hod</Button><Button type="button" disabled={isLoading || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Shranjujem …" : existing ? "Shrani konfiguracijo" : "Ustvari konfiguracijo"}</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}