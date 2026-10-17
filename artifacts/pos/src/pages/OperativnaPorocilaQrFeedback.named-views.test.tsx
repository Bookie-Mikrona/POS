import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OperativnaPorocilaQrFeedback } from "./OperativnaPorocilaQrFeedback";
import {
  DEFAULT_ARTICLE_VIEW,
  parseNamedArticleViews,
  QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY,
  QR_FEEDBACK_NAMED_ARTICLE_VIEWS_STORAGE_KEY,
} from "@/lib/qr-feedback-article-views";

const { feedback } = vi.hoisted(() => ({ feedback: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useGetOperativnaPorocilaQrFeedback: feedback,
  getGetOperativnaPorocilaQrFeedbackQueryKey: (params: unknown) => ["feedback", params],
  useGetOperativnaPorocilaQrFeedbackComments: () => ({ data: { comments: [] }, isLoading: false }),
  getGetOperativnaPorocilaQrFeedbackCommentsQueryKey: (params: unknown) => ["comments", params],
  exportOperativnaPorocilaQrFeedback: vi.fn(),
}));
vi.mock("recharts", () => ({
  ResponsiveContainer: () => null,
  LineChart: () => null, Line: () => null, XAxis: () => null, YAxis: () => null,
  CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
}));

function openReport() {
  return render(<OperativnaPorocilaQrFeedback queryParams={{ od: "2026-09-01", do: "2026-09-03" }} />);
}
function saveNamedView(name: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Ime pogleda" }), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Shrani pogled" }));
}
const savedViews = () => parseNamedArticleViews(localStorage.getItem(QR_FEEDBACK_NAMED_ARTICLE_VIEWS_STORAGE_KEY));
const currentView = () => JSON.parse(localStorage.getItem(QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY)!);

describe("Poimenovani pogledi QR ocen", () => {
  beforeEach(() => {
    localStorage.clear();
    feedback.mockReset().mockReturnValue({
      data: {
        totals: { responses: 10, smallSample: false, minimumSample: 5 },
        dimensions: {
          food: { average: 4, count: 10, smallSample: false },
          ambience: { average: 4, count: 10, smallSample: false },
          service: { average: 4, count: 10, smallSample: false },
        },
        comparison: {
          current: { od: "2026-09-01", do: "2026-09-03", responses: 10, smallSample: false },
          previous: { od: "2026-08-29", do: "2026-08-31", responses: 10, smallSample: false },
          dimensions: {
            food: { currentAverage: 4, previousAverage: 4, difference: 0, direction: "unchanged" },
            ambience: { currentAverage: 4, previousAverage: 4, difference: 0, direction: "unchanged" },
            service: { currentAverage: 4, previousAverage: 4, difference: 0, direction: "unchanged" },
          },
        },
        trends: [], warnings: [],
        articles: [
          { articleName: "Kava", current: { average: 5, count: 5 }, previous: { average: 4, count: 5 }, difference: 1, direction: "improved" },
          { articleName: "Čaj", current: { average: 3, count: 8 }, previous: { average: 3, count: 6 }, difference: 0, direction: "unchanged" },
        ],
        comments: { count: 0 },
      },
      isLoading: false,
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("shrani različni imeni in po vrnitvi uporabi celotno kombinacijo ter ohrani Ponastavi", async () => {
    const report = openReport();
    fireEvent.change(screen.getByTestId("input-article-search"), { target: { value: "caj" } });
    fireEvent.click(screen.getByTestId("filter-article-improved"));
    fireEvent.click(screen.getByTestId("select-article-sort"));
    fireEvent.click(await screen.findByText("Velikost vzorca"));
    fireEvent.click(screen.getByTestId("button-article-sort-order"));
    const expected = currentView();
    saveNamedView("  Mali vzorci  ");
    fireEvent.click(screen.getByTestId("button-reset-article-filters"));
    saveNamedView("Vsi");
    expect(savedViews()).toEqual([
      { name: "Mali vzorci", view: expected }, { name: "Vsi", view: DEFAULT_ARTICLE_VIEW },
    ]);
    report.unmount();
    openReport();
    const paramsBefore = feedback.mock.lastCall;
    fireEvent.click(screen.getByRole("button", { name: "Uporabi pogled Mali vzorci" }));
    expect(currentView()).toEqual(expected);
    expect(screen.getByTestId("article-name-čaj")).not.toBeNull();
    expect(screen.queryByTestId("article-name-kava")).toBeNull();
    expect(screen.getByTestId("select-article-sort").textContent).toContain("Velikost vzorca");
    expect(screen.getByTestId("button-article-sort-order").textContent).toContain("Naraščajoče");
    expect(feedback.mock.lastCall).toEqual(paramsBefore);
    fireEvent.click(screen.getByRole("button", { name: "Uporabi pogled Vsi" }));
    expect(currentView()).toEqual(DEFAULT_ARTICLE_VIEW);
    fireEvent.click(screen.getByRole("button", { name: "Uporabi pogled Mali vzorci" }));
    fireEvent.click(screen.getByTestId("button-reset-article-filters"));
    expect(currentView()).toEqual(DEFAULT_ARTICLE_VIEW);
    expect(savedViews()).toHaveLength(2);
  });

  it("izbris odstrani le izbrani pogled tudi po vrnitvi in ne spremeni aktivnih filtrov", () => {
    const report = openReport();
    saveNamedView("Prvi");
    saveNamedView("Drugi");
    fireEvent.change(screen.getByTestId("input-article-search"), { target: { value: "kava" } });
    fireEvent.click(screen.getByRole("button", { name: "Izbriši pogled Prvi" }));
    expect(savedViews().map(view => view.name)).toEqual(["Drugi"]);
    expect(currentView().search).toBe("kava");
    report.unmount();
    openReport();
    expect(screen.queryByRole("button", { name: "Uporabi pogled Prvi" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Izbriši pogled Drugi" }));
    expect(savedViews()).toEqual([]);
    expect(screen.getByTestId("button-reset-article-filters")).not.toBeNull();
  });

  it("prazno ali podvojeno ime ne prepiše obstoječega pogleda", () => {
    openReport();
    saveNamedView("   ");
    expect(screen.getByRole("alert").textContent).toContain("Vnesite ime");
    saveNamedView("Čaj");
    fireEvent.change(screen.getByTestId("input-article-search"), { target: { value: "kava" } });
    saveNamedView(" čAJ ");
    expect(screen.getByRole("alert").textContent).toContain("že obstaja");
    expect(savedViews()).toEqual([{ name: "Čaj", view: DEFAULT_ARTICLE_VIEW }]);
  });

  it("posamezni poškodovani ali zastareli zapis ne pokvari veljavnih, niti po brisanju in vrnitvi", () => {
    const legacy = { ...DEFAULT_ARTICLE_VIEW };
    Reflect.deleteProperty(legacy, "sortOrder");
    localStorage.setItem(QR_FEEDBACK_NAMED_ARTICLE_VIEWS_STORAGE_KEY, JSON.stringify([
      null, "broken", { name: "Brez nastavitev" },
      { name: "Zastarel", view: { ...DEFAULT_ARTICLE_VIEW, version: 9 } },
      { name: "Napačno razvrščanje", view: { ...DEFAULT_ARTICLE_VIEW, sort: "unknown" } },
      { name: "Napačna smer", view: { ...DEFAULT_ARTICLE_VIEW, sortOrder: "sideways" } },
      { name: "Manjka filter", view: { ...DEFAULT_ARTICLE_VIEW, directions: { improved: true } } },
      { name: "Veljaven", view: { ...DEFAULT_ARTICLE_VIEW, search: "caj" } },
      { name: " VELJAVEN ", view: DEFAULT_ARTICLE_VIEW },
      { name: "Starejši", view: legacy },
    ]));
    const report = openReport();
    expect(screen.getAllByRole("button", { name: /^Uporabi pogled/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Uporabi pogled Veljaven" }));
    expect(screen.getByTestId("article-name-čaj")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Izbriši pogled Starejši" }));
    report.unmount();
    openReport();
    expect(screen.getByRole("button", { name: "Uporabi pogled Veljaven" })).not.toBeNull();
    expect(parseNamedArticleViews("{broken")).toEqual([]);
    expect(parseNamedArticleViews('{"version":99}')).toEqual([]);
    expect(parseNamedArticleViews("null")).toEqual([]);
  });

  it("neuspešno shranjevanje in brisanje jasno sporoči ter ohrani obstoječe poglede", () => {
    openReport();
    saveNamedView("Vsi");
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota"); });
    try {
      saveNamedView("Nov");
      expect(screen.getByRole("alert").textContent).toContain("ni bilo mogoče shraniti");
      expect(screen.queryByRole("button", { name: "Uporabi pogled Nov" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Izbriši pogled Vsi" }));
      expect(screen.getByRole("button", { name: "Uporabi pogled Vsi" })).not.toBeNull();
      fireEvent.change(screen.getByTestId("input-article-search"), { target: { value: "kava" } });
      expect(screen.getByTestId("article-name-kava")).not.toBeNull();
    } finally {
      storage.mockRestore();
    }
  });

  it("nedostopno branje shrambe ne prepreči prikaza poročila", () => {
    const storage = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Denied"); });
    try {
      openReport();
      expect(screen.getByTestId("article-name-kava")).not.toBeNull();
      expect(screen.queryByRole("button", { name: /^Uporabi pogled/ })).toBeNull();
    } finally {
      storage.mockRestore();
    }
  });
});
