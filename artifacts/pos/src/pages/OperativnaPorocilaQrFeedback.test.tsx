import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Children, cloneElement, isValidElement, type ComponentProps, type ReactElement } from "react";
import {
  buildTrendChartData,
  OperativnaPorocilaQrFeedback,
  parseStoredArticleView,
  QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY,
  QR_FEEDBACK_GRANULARITY_STORAGE_KEY,
  SmallSampleDot,
  TrendTooltip,
} from "./OperativnaPorocilaQrFeedback";

const { mockUseFeedback, mockUseComments, mockExportFeedback } = vi.hoisted(() => ({
  mockUseFeedback: vi.fn(),
  mockUseComments: vi.fn(),
  mockExportFeedback: vi.fn(),
}));

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual("@workspace/api-client-react");
  return {
    ...actual as object,
    useGetOperativnaPorocilaQrFeedback: mockUseFeedback,
    useGetOperativnaPorocilaQrFeedbackComments: mockUseComments,
    exportOperativnaPorocilaQrFeedback: mockExportFeedback,
  };
});

// Keep real Recharts SVG/legend rendering, with fixed layout and no animation:
// jsdom cannot measure container sizes or SVG path lengths.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement<ComponentProps<typeof actual.LineChart>> }) => (
      cloneElement(children, { width: 640, height: 300 },
        Children.map(children.props.children, child =>
          isValidElement<{ isAnimationActive?: boolean }>(child) && child.type === actual.Line
            ? cloneElement(child, { isAnimationActive: false })
            : child))
    ),
  };
});

const feedbackReport = {
  scope: { od: "2026-09-01", do: "2026-09-03", granularity: "day", timeZone: "Europe/Ljubljana", units: [] },
  totals: { responses: 12, smallSample: false, minimumSample: 5 },
  dimensions: {
    food: { average: 4.8, count: 10, smallSample: false },
    ambience: { average: 3.5, count: 12, smallSample: false },
    service: { average: null, count: 0, smallSample: true },
  },
  comparison: {
    current: { od: "2026-09-01", do: "2026-09-03", responses: 12, smallSample: false },
    previous: { od: "2026-08-29", do: "2026-08-31", responses: 3, smallSample: true },
    dimensions: {
      food: { currentAverage: 4.8, previousAverage: 4.2, difference: 0.6, direction: "unavailable", directionReason: "Smer ni določena: v obeh obdobjih je potrebnih vsaj 5 odzivov." },
      ambience: { currentAverage: 3.5, previousAverage: 4, difference: -0.5, direction: "unavailable", directionReason: "Smer ni določena: v obeh obdobjih je potrebnih vsaj 5 odzivov." },
      service: { currentAverage: null, previousAverage: 4, difference: null, direction: "unavailable", directionReason: "Smer ni določena, ker ni ocen v obeh obdobjih." },
    },
  },
  trends: [
    { periodStart: "2026-09-01", periodEnd: "2026-09-01", responses: 6, foodAverage: 4.5, ambienceAverage: 3.0, serviceAverage: null, smallSample: false },
    { periodStart: "2026-09-02", periodEnd: "2026-09-02", responses: 2, foodAverage: 5.0, ambienceAverage: 4.0, serviceAverage: null, smallSample: true },
  ],
  articles: [
    { articleName: "Kava", current: { average: 5, count: 5, smallSample: false }, previous: { average: 4, count: 5, smallSample: false }, difference: 1, direction: "improved", directionReason: null },
    { articleName: "Espresso", current: { average: 2.5, count: 10, smallSample: false }, previous: { average: 3.5, count: 8, smallSample: false }, difference: -1, direction: "declined", directionReason: null },
    { articleName: "Čaj", current: { average: 3.5, count: 8, smallSample: false }, previous: { average: 3.5, count: 6, smallSample: false }, difference: 0, direction: "unchanged", directionReason: null },
    { articleName: "Sladoled", current: { average: 4.5, count: 2, smallSample: true }, previous: { average: null, count: 0, smallSample: true }, difference: null, direction: "unavailable", directionReason: "Smer ni določena, ker artikel nima ocen v obeh obdobjih." },
    { articleName: "Pizza", current: { average: 5.0, count: 4, smallSample: true }, previous: { average: 4.0, count: 3, smallSample: true }, difference: 1, direction: "unavailable", directionReason: "Smer ni določena: v obeh obdobjih je potrebnih vsaj 5 ocen." },
  ],
  warnings: [
    { code: "SMALL_SAMPLE", minimumSample: 5, message: "Service metrics are unreliable." }
  ],
  comments: { count: 1 }
};

const commentsPage = {
  scope: { od: "2026-09-01", do: "2026-09-03", timeZone: "Europe/Ljubljana", units: [] },
  page: 2,
  pageSize: 10,
  total: 11,
  totalPages: 2,
  protected: true as const,
  comments: [
    { unitName: "Glavna", createdAt: "2026-09-02T12:00:00Z", text: "Great food, but no service rating." }
  ]
};

function renderComponent(props = { od: "2026-09-01", do: "2026-09-03" }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OperativnaPorocilaQrFeedback queryParams={props} />
    </QueryClientProvider>
  );
}

describe("OperativnaPorocilaQrFeedback", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseFeedback.mockReset();
    mockUseComments.mockReset();
    mockExportFeedback.mockReset();

    mockUseFeedback.mockReturnValue({
      data: feedbackReport,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });

    mockUseComments.mockReturnValue({
      data: commentsPage,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null
    });
    
    // Mock URL.createObjectURL for export test
    global.URL.createObjectURL = vi.fn().mockReturnValue("blob:test");
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("renders metrics, trend chart, and articles", () => {
    renderComponent();

    // Dimensions
    expect(screen.getByTestId("card-metric-hrana").textContent).toContain("4.8");
    expect(screen.getByTestId("card-metric-ambient").textContent).toContain("3.5");
    expect(screen.getByTestId("comparison-periods").textContent).toContain("29. 8. 2026");
    expect(screen.getByTestId("comparison-periods").textContent).toContain("Prej: 3 odzivov · majhen vzorec");
    expect(screen.getByTestId("metric-comparison-hrana").textContent).toContain("+0.6 točke · nezanesljivo");
    expect(screen.getByTestId("metric-comparison-ambient").textContent).toContain("-0.5 točke · nezanesljivo");
    expect(screen.getByTestId("metric-direction-reason-hrana").textContent).toContain("vsaj 5 odzivov");
    expect(screen.getByTestId("metric-direction-reason-ambient").textContent).toContain("vsaj 5 odzivov");
    expect(screen.getByTestId("metric-comparison-postrežba").textContent).toContain("Primerjava ni na voljo");
    expect(screen.getByTestId("trend-sample-legend").textContent).toContain("Vsaj 5 odzivov");
    expect(screen.getByTestId("trend-sample-legend").textContent).toContain("majhen vzorec, brez povezovalne črte");

    expect(screen.getByTestId("article-result-count").textContent).toContain("5 od 5");
    expect(screen.getByTestId("article-direction-kava").textContent).toContain("Izboljšani");
    expect(screen.getByTestId("article-direction-espresso").textContent).toContain("Poslabšani");
    expect(screen.getByTestId("article-direction-čaj").textContent).toContain("Nespremenjeni");
    expect(screen.getByTestId("article-direction-pizza").textContent).toContain("Neprimerljivi");
    expect(screen.getByTestId("article-comparison-pizza").textContent).toContain("Zdaj 5.0 · 4 ocen*");
    expect(screen.getByTestId("article-comparison-pizza").textContent).toContain("Prej 4.0 · 3 ocen*");
    expect(screen.getByTestId("article-comparison-pizza").textContent).toContain("+1.0");
    expect(screen.getByTestId("article-direction-reason-pizza").textContent).toContain("vsaj 5 ocen");
    expect(screen.getByTestId("article-comparison-espresso").textContent).toContain("-1.0");
  });

  it("razloči vse tri serije z vzorci črt tudi v legendi in loči majhen vzorec", () => {
    mockUseFeedback.mockReturnValue({
      ...mockUseFeedback(),
      data: {
        ...feedbackReport,
        trends: [
          { ...feedbackReport.trends[0], serviceAverage: 4 },
          { ...feedbackReport.trends[0], periodStart: "2026-09-02", periodEnd: "2026-09-02", serviceAverage: 4.5 },
          { ...feedbackReport.trends[1], periodStart: "2026-09-03", periodEnd: "2026-09-03", serviceAverage: 3 },
        ],
      },
    });
    const { container } = renderComponent();
    const expectedPatterns = [
      { name: "Hrana", dash: null },
      { name: "Ambient", dash: "8 4" },
      { name: "Postrežba", dash: "2 4" },
    ];
    const curves = container.querySelectorAll('.recharts-line-curve:not([stroke="transparent"])');
    const smallSampleCurves = container.querySelectorAll('.recharts-line-curve[stroke="transparent"]');
    const legendItems = Array.from(container.querySelectorAll(".recharts-legend-item"));
    expect(curves.length).toBe(3);
    expect(smallSampleCurves.length).toBe(3);
    expect(legendItems.length).toBe(3);
    expectedPatterns.forEach(({ name, dash }, index) => {
      expect(curves[index].getAttribute("stroke-dasharray")).toBe(dash);
      const legendItem = legendItems.find(item => item.textContent === name);
      const legendLine = legendItem?.querySelector("line");
      expect(legendLine).toBeTruthy();
      expect(legendLine!.getAttribute("stroke-dasharray")).toBe(dash);
    });

    const smallSampleDots = screen.getAllByTestId("trend-dot-small-sample");
    expect(smallSampleDots.length).toBe(3);
    smallSampleDots.forEach(dot => {
      expect(dot.tagName).toBe("circle");
      expect(dot.getAttribute("fill")).toBe("hsl(var(--background))");
      expect(dot.getAttribute("stroke-dasharray")).toBe("2 1");
    });
    container.querySelectorAll(".recharts-line-dot").forEach(dot => {
      expect(dot.getAttribute("r")).toBe("4");
      expect(dot.getAttribute("fill")).not.toBe("hsl(var(--background))");
    });
    expect(screen.getByTestId("trend-sample-legend").textContent).toContain("majhen vzorec, brez povezovalne črte");
  });

  it("ločeno pripravi zanesljive in nezanesljive točke brez povezovanja majhnega vzorca", () => {
    const chartData = buildTrendChartData(feedbackReport.trends);
    expect(chartData[0]).toMatchObject({
      foodReliable: 4.5,
      ambienceReliable: 3,
      foodSmallSample: null,
      ambienceSmallSample: null,
    });
    expect(chartData[1]).toMatchObject({
      foodReliable: null,
      ambienceReliable: null,
      foodSmallSample: 5,
      ambienceSmallSample: 4,
    });

    const { rerender } = render(<svg><SmallSampleDot cx={20} cy={30} /></svg>);
    expect(screen.getByTestId("trend-dot-small-sample").getAttribute("stroke")).toBe("#f59e0b");
    rerender(<svg><SmallSampleDot cx={20} cy={30} active /></svg>);
    expect(screen.getByTestId("trend-dot-small-sample").getAttribute("r")).toBe("7");
  });

  it("tooltip pokaže odzive in opozori samo pri nezanesljivi točki", () => {
    const [reliable, unreliable] = buildTrendChartData(feedbackReport.trends);
    const { rerender } = render(
      <TrendTooltip active payload={[{ payload: reliable }]} />,
    );
    expect(screen.getByTestId("trend-tooltip").textContent).toContain("6 odzivov");
    expect(screen.queryByTestId("trend-tooltip-small-sample")).toBeNull();

    rerender(<TrendTooltip active payload={[{ payload: unreliable }]} />);
    expect(screen.getByTestId("trend-tooltip").textContent).toContain("2 odzivov");
    expect(screen.getByTestId("trend-tooltip-small-sample").textContent).toContain("manj kot 5 odzivov");
  });

  it.each(["day", "week"])("ohrani prazni %s interval med ocenama in pojasni vrzel brez ničelne ocene", (granularity) => {
    const periods = granularity === "day"
      ? [["2026-09-01", "2026-09-01"], ["2026-09-02", "2026-09-02"], ["2026-09-03", "2026-09-03"]]
      : [["2026-09-01", "2026-09-06"], ["2026-09-07", "2026-09-13"], ["2026-09-14", "2026-09-20"]];
    const trends = periods.map(([periodStart, periodEnd], index) => ({
      periodStart: periodStart!, periodEnd: periodEnd!,
      responses: index === 1 ? 0 : 6,
      foodAverage: index === 1 ? null : 5,
      ambienceAverage: index === 1 ? null : 4,
      serviceAverage: index === 1 ? null : 3,
      smallSample: index === 1,
    }));
    const chartData = buildTrendChartData(trends);
    expect(chartData.map(row => row.foodReliable)).toEqual([5, null, 5]);
    expect(chartData.map(row => row.ambienceReliable)).toEqual([4, null, 4]);
    expect(chartData.map(row => row.serviceReliable)).toEqual([3, null, 3]);
    expect(chartData[1]).toMatchObject({
      foodSmallSample: null, ambienceSmallSample: null, serviceSmallSample: null,
    });
    render(<TrendTooltip active payload={[{ payload: chartData[1] }]} />);
    expect(screen.getByTestId("trend-tooltip").textContent).toContain("0 odzivov");
    expect(screen.getByTestId("trend-tooltip-empty").textContent).toBe("V tem obdobju ni bilo odzivov.");
    expect(screen.queryByTestId("trend-tooltip-small-sample")).toBeNull();
  });

  it("renders honest single-result article state", () => {
    mockUseFeedback.mockReturnValue({
      ...mockUseFeedback(),
      data: {
        ...feedbackReport,
        articles: [{
          articleName: "Sok",
          current: { average: 4, count: 5, smallSample: false },
          previous: { average: 3, count: 4, smallSample: true },
          difference: 1,
          direction: "unavailable",
          directionReason: "Smer ni določena: v obeh obdobjih je potrebnih vsaj 5 ocen.",
        }]
      }
    });
    renderComponent();
    expect(screen.getByTestId("article-name-sok")).not.toBeNull();
    expect(screen.getByTestId("article-direction-sok").textContent).toContain("Neprimerljivi");
    expect(screen.getByTestId("article-direction-reason-sok").textContent).toContain("vsaj 5 ocen");
  });

  it("išče po zgodovinskem nazivu brez občutljivosti na velike črke in diakritiko", () => {
    renderComponent();

    fireEvent.change(screen.getByTestId("input-article-search"), { target: { value: "CAJ" } });

    expect(screen.getByTestId("article-name-čaj").textContent).toBe("Čaj");
    expect(screen.queryByTestId("article-name-kava")).toBeNull();
    expect(screen.getByTestId("article-result-count").textContent).toContain("1 od 5");
  });

  it("kombinira smerne filtre, pokaže prazen rezultat in jih ponastavi", () => {
    renderComponent();

    fireEvent.click(screen.getByTestId("filter-article-improved"));
    fireEvent.click(screen.getByTestId("filter-article-declined"));
    fireEvent.click(screen.getByTestId("filter-article-unchanged"));

    expect(screen.queryByTestId("article-name-kava")).toBeNull();
    expect(screen.queryByTestId("article-name-espresso")).toBeNull();
    expect(screen.queryByTestId("article-name-čaj")).toBeNull();
    expect(screen.getByTestId("article-name-pizza")).not.toBeNull();
    expect(screen.getByTestId("article-name-sladoled")).not.toBeNull();
    expect(screen.getByTestId("article-result-count").textContent).toContain("2 od 5");

    fireEvent.click(screen.getByTestId("filter-article-unavailable"));
    expect(screen.getByTestId("empty-filtered-article-comparison")).not.toBeNull();

    fireEvent.click(screen.getByTestId("button-reset-article-filters"));
    expect(screen.getByTestId("article-result-count").textContent).toContain("5 od 5");
    expect(JSON.parse(localStorage.getItem(QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY)!)).toMatchObject({
      search: "",
      sort: "difference",
      sortOrder: "descending",
      directions: {
        improved: true,
        declined: true,
        unchanged: true,
        unavailable: true,
      },
    });
  });

  it("razvrsti v obe smeri po razliki, trenutni oceni in velikosti vzorca, null pa ohrani na koncu", async () => {
    renderComponent();

    const visibleNames = () => screen.getAllByTestId(/^article-name-/).map(cell => cell.textContent);
    expect(visibleNames()).toEqual(["Espresso", "Kava", "Pizza", "Čaj", "Sladoled"]);
    fireEvent.click(screen.getByTestId("button-article-sort-order"));
    expect(visibleNames()).toEqual(["Čaj", "Espresso", "Kava", "Pizza", "Sladoled"]);

    fireEvent.click(screen.getByTestId("select-article-sort"));
    fireEvent.click(await screen.findByText("Trenutna ocena"));
    expect(visibleNames()).toEqual(["Espresso", "Čaj", "Sladoled", "Kava", "Pizza"]);
    fireEvent.click(screen.getByTestId("button-article-sort-order"));
    expect(visibleNames()).toEqual(["Kava", "Pizza", "Sladoled", "Čaj", "Espresso"]);

    fireEvent.click(screen.getByTestId("select-article-sort"));
    fireEvent.click(await screen.findByText("Velikost vzorca"));
    expect(visibleNames()).toEqual(["Espresso", "Čaj", "Kava", "Pizza", "Sladoled"]);
    fireEvent.click(screen.getByTestId("button-article-sort-order"));
    expect(visibleNames()).toEqual(["Sladoled", "Pizza", "Kava", "Čaj", "Espresso"]);
  });

  it("naraščajoče razvrščanje deluje skupaj z iskanjem in smernimi filtri", async () => {
    renderComponent();
    fireEvent.change(screen.getByTestId("input-article-search"), { target: { value: "a" } });
    fireEvent.click(screen.getByTestId("filter-article-improved"));
    fireEvent.click(screen.getByTestId("filter-article-declined"));
    fireEvent.click(screen.getByTestId("filter-article-unchanged"));
    fireEvent.click(screen.getByTestId("select-article-sort"));
    fireEvent.click(await screen.findByText("Trenutna ocena"));
    fireEvent.click(screen.getByTestId("button-article-sort-order"));
    expect(screen.getAllByTestId(/^article-name-/).map(cell => cell.textContent)).toEqual(["Sladoled", "Pizza"]);
  });

  it.each([
    { label: "Ocena", criterion: "currentAverage", selectLabel: "Trenutna ocena", descending: ["Kava", "Pizza", "Sladoled", "Čaj", "Espresso"], ascending: ["Espresso", "Čaj", "Sladoled", "Kava", "Pizza"] },
    { label: "Premik", criterion: "difference", selectLabel: "Največja sprememba", descending: ["Espresso", "Kava", "Pizza", "Čaj", "Sladoled"], ascending: ["Čaj", "Espresso", "Kava", "Pizza", "Sladoled"] },
    { label: "Vzorec", criterion: "sampleSize", selectLabel: "Velikost vzorca", descending: ["Espresso", "Čaj", "Kava", "Pizza", "Sladoled"], ascending: ["Sladoled", "Pizza", "Kava", "Čaj", "Espresso"] },
  ])("glava $label izbere kriterij in nato obrne smer ter uskladi kontroli", ({ label, criterion, selectLabel, descending, ascending }) => {
    renderComponent();
    const headerButton = screen.getByRole("button", { name: new RegExp(`^Razvrsti: ${label}\\.`) });
    const header = headerButton.closest("th")!;
    const visibleNames = () => screen.getAllByTestId(/^article-name-/).map(cell => cell.textContent);
    // Select a different column first when the tested one is the default.
    if (criterion === "difference") {
      fireEvent.click(screen.getByRole("button", { name: /^Razvrsti: Ocena\./ }));
    }
    fireEvent.click(headerButton);
    expect(visibleNames()).toEqual(descending);
    expect(header.getAttribute("aria-sort")).toBe("descending");
    expect(screen.getByTestId("select-article-sort").textContent).toContain(selectLabel);
    expect(screen.getByTestId("button-article-sort-order").textContent).toContain("Padajoče");
    expect(headerButton.querySelector(".lucide-arrow-down")).not.toBeNull();
    expect(screen.getAllByRole("columnheader").filter(cell => cell.hasAttribute("aria-sort"))).toEqual([header]);

    fireEvent.click(headerButton);
    expect(visibleNames()).toEqual(ascending);
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(headerButton.querySelector(".lucide-arrow-up")).not.toBeNull();
    expect(screen.getByTestId("button-article-sort-order").textContent).toContain("Naraščajoče");
    expect(JSON.parse(localStorage.getItem(QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY)!)).toMatchObject({
      sort: criterion,
      sortOrder: "ascending",
    });
  });

  it("obstoječi kontroli, obnova in ponastavitev uskladijo aktivno glavo", async () => {
    localStorage.setItem(QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY, JSON.stringify({
      ...parseStoredArticleView(null),
      sort: "sampleSize",
      sortOrder: "ascending",
    }));
    renderComponent();
    const sample = screen.getByRole("button", { name: /^Razvrsti: Vzorec\./ }).closest("th")!;
    const rating = screen.getByRole("button", { name: /^Razvrsti: Ocena\./ }).closest("th")!;
    const movement = screen.getByRole("button", { name: /^Razvrsti: Premik\./ }).closest("th")!;
    expect(sample.getAttribute("aria-sort")).toBe("ascending");

    fireEvent.click(screen.getByTestId("select-article-sort"));
    fireEvent.click(await screen.findByText("Trenutna ocena"));
    expect(rating.getAttribute("aria-sort")).toBe("ascending");
    expect(sample.hasAttribute("aria-sort")).toBe(false);
    fireEvent.click(screen.getByTestId("button-article-sort-order"));
    expect(rating.getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(screen.getByTestId("button-reset-article-filters"));
    expect(movement.getAttribute("aria-sort")).toBe("descending");
    expect(rating.hasAttribute("aria-sort")).toBe(false);
    fireEvent.click(screen.getByTestId("button-article-sort-order"));
    fireEvent.click(screen.getByRole("button", { name: /^Razvrsti: Ocena\./ }));
    expect(rating.getAttribute("aria-sort")).toBe("ascending");
  });

  it("glave uporabljajo naravne gumbe s fokusom za tipkovnico in ohranijo filtre", () => {
    renderComponent();
    for (const label of ["Ocena", "Premik", "Vzorec"]) {
      const button = screen.getByRole("button", { name: new RegExp(`^Razvrsti: ${label}\\.`) }) as HTMLButtonElement;
      expect(button.tagName).toBe("BUTTON");
      expect(button.type).toBe("button");
      expect(button.tabIndex).toBe(0);
      button.focus();
      expect(document.activeElement).toBe(button);
      expect(button.closest("th")?.getAttribute("scope")).toBe("col");
    }
    fireEvent.change(screen.getByTestId("input-article-search"), { target: { value: "a" } });
    fireEvent.click(screen.getByTestId("filter-article-unavailable"));
    fireEvent.click(screen.getByRole("button", { name: /^Razvrsti: Vzorec\./ }));
    expect(screen.getAllByTestId(/^article-name-/).map(cell => cell.textContent)).toEqual(["Čaj", "Kava"]);
    expect(screen.getByTestId("article-result-count").textContent).toContain("2 od 5");
  });

  it("ob vrnitvi obnovi iskanje, smerne filtre in razvrščanje iz lokalnega brskalnika", async () => {
    const first = renderComponent();
    fireEvent.change(screen.getByTestId("input-article-search"), { target: { value: "caj" } });
    fireEvent.click(screen.getByTestId("filter-article-improved"));
    fireEvent.click(screen.getByTestId("select-article-sort"));
    fireEvent.click(await screen.findByText("Velikost vzorca"));
    fireEvent.click(screen.getByTestId("button-article-sort-order"));

    await waitFor(() => {
      expect(localStorage.getItem(QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY)).toContain('"search":"caj"');
    });
    first.unmount();
    renderComponent();

    expect((screen.getByTestId("input-article-search") as HTMLInputElement).value).toBe("caj");
    expect(screen.getByTestId("filter-article-improved").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("filter-article-declined").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("select-article-sort").textContent).toContain("Velikost vzorca");
    expect(screen.getByTestId("button-article-sort-order").textContent).toContain("Naraščajoče");
    expect(screen.getByTestId("article-result-count").textContent).toContain("1 od 5");
  });

  it("neveljaven star lokalni zapis varno ponastavi na privzeti pogled", () => {
    localStorage.setItem(QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY, JSON.stringify({
      version: 1,
      search: "kava",
      sort: "unknown-sort",
      directions: {
        improved: false,
        declined: true,
        unchanged: true,
        unavailable: true,
      },
    }));

    renderComponent();

    expect((screen.getByTestId("input-article-search") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("select-article-sort").textContent).toContain("Največja sprememba");
    expect(screen.getByTestId("filter-article-improved").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("article-result-count").textContent).toContain("5 od 5");
    expect(JSON.parse(localStorage.getItem(QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY)!)).toMatchObject({
      version: 1,
      search: "",
      sort: "difference",
      sortOrder: "descending",
    });
  });

  it("parser zavrne poškodovan zapis in manjkajočo smer", () => {
    expect(parseStoredArticleView("{broken")).toMatchObject({ search: "", sort: "difference" });
    expect(parseStoredArticleView(JSON.stringify({
      version: 1,
      search: "test",
      sort: "sampleSize",
      directions: { improved: true, declined: true, unchanged: true },
    }))).toMatchObject({ search: "", sort: "difference" });
    expect(parseStoredArticleView(JSON.stringify({
      version: 1,
      search: "test",
      sort: "sampleSize",
      directions: {
        improved: true,
        declined: true,
        unchanged: true,
        unavailable: true,
        legacyDirection: true,
      },
    }))).toMatchObject({ search: "", sort: "difference" });
  });

  it("shows both sample sizes without a misleading delta when the current period is empty", () => {
    mockUseFeedback.mockReturnValue({
      ...mockUseFeedback(),
      data: {
        ...feedbackReport,
        totals: { responses: 0, smallSample: true, minimumSample: 5 },
        dimensions: {
          food: { average: null, count: 0, smallSample: true },
          ambience: { average: null, count: 0, smallSample: true },
          service: { average: null, count: 0, smallSample: true },
        },
        comparison: {
          current: { od: "2026-09-01", do: "2026-09-03", responses: 0, smallSample: true },
          previous: { od: "2026-08-29", do: "2026-08-31", responses: 8, smallSample: false },
          dimensions: {
            food: { currentAverage: null, previousAverage: 4.2, difference: null, direction: "unavailable" },
            ambience: { currentAverage: null, previousAverage: 4, difference: null, direction: "unavailable" },
            service: { currentAverage: null, previousAverage: 4, difference: null, direction: "unavailable" },
          },
        },
        trends: [],
        articles: [],
        comments: { count: 0 },
      },
    });
    renderComponent();
    expect(screen.getByTestId("comparison-periods").textContent).toContain("Trenutno: 0 odzivov · majhen vzorec");
    expect(screen.getByTestId("comparison-periods").textContent).toContain("Prej: 8 odzivov");
    expect(screen.getByTestId("empty-comparison-state").textContent).toContain("Primerjava ni na voljo");
    expect(screen.queryByTestId("metric-comparison-hrana")).toBeNull();
  });

  it("renders clear error state when comments fail but aggregate succeeds", () => {
    mockUseComments.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: { message: "Internal Server Error" }
    });
    renderComponent();
    
    // Overall page still renders fine
    expect(screen.getByText("Zadovoljstvo gostov (QR)")).not.toBeNull();
    // But comments section has error
    expect(screen.getByTestId("error-comments-state")).not.toBeNull();
    expect(screen.getByText(/Napaka pri nalaganju komentarjev:/)).not.toBeNull();
  });
  
  it("renders true empty comments state distinctly", () => {
    mockUseFeedback.mockReturnValue({
      ...mockUseFeedback(),
      data: {
        ...feedbackReport,
        comments: { count: 0 } // true empty from aggregate
      }
    });
    renderComponent();
    expect(screen.getByTestId("empty-comments-state")).not.toBeNull();
    expect(screen.queryByTestId("error-comments-state")).toBeNull();
  });

  it("renders plain text comments without identifiers", () => {
    renderComponent();
    expect(screen.getByText("Komentarji gostov")).not.toBeNull();
    expect(screen.getByText("Great food, but no service rating.")).not.toBeNull();
    // Unit name and formatted date
    expect(screen.getByText("Glavna")).not.toBeNull();
    expect(screen.getByText(/02\. 09\. 2026/)).not.toBeNull();
  });

  it.each([
    ["day", "week", "Po dnevih"],
    ["week", "day", "Po tednih"],
  ] as const)("shrani in ob vrnitvi obnovi prikaz %s", async (granularity, initial, label) => {
    localStorage.setItem(QR_FEEDBACK_GRANULARITY_STORAGE_KEY, initial);
    const first = renderComponent();
    fireEvent.click(screen.getByTestId("select-granularity"));
    fireEvent.click(await screen.findByTestId(`select-option-${granularity}`));

    expect(localStorage.getItem(QR_FEEDBACK_GRANULARITY_STORAGE_KEY)).toBe(granularity);
    first.unmount();
    mockUseFeedback.mockClear();
    mockUseComments.mockClear();
    renderComponent();

    expect(screen.getByTestId("select-granularity").textContent).toContain(label);
    expect(mockUseFeedback.mock.calls[0][0]).toMatchObject({ granularity });
    expect(mockUseComments.mock.calls[0][0]).toMatchObject({ granularity, page: 1 });
  });

  it.each([null, "month", "", "WEEK", '{"granularity":"week"}'])(
    "manjkajoč ali neveljaven prikaz %s ponastavi na day",
    (stored) => {
      if (stored !== null) localStorage.setItem(QR_FEEDBACK_GRANULARITY_STORAGE_KEY, stored);
      renderComponent();
      expect(screen.getByTestId("select-granularity").textContent).toContain("Po dnevih");
      expect(mockUseFeedback).toHaveBeenLastCalledWith(
        expect.objectContaining({ granularity: "day" }),
        expect.anything(),
      );
      expect(localStorage.getItem(QR_FEEDBACK_GRANULARITY_STORAGE_KEY)).toBe("day");
    },
  );

  it("resets comment page to 1 when date changes and keeps the saved granularity", () => {
    localStorage.setItem(QR_FEEDBACK_GRANULARITY_STORAGE_KEY, "week");
    mockUseComments.mockImplementation(({ page }) => ({
      data: { ...commentsPage, page },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <OperativnaPorocilaQrFeedback queryParams={{ od: "2026-09-01", do: "2026-09-03" }} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByTestId("button-comments-next"));
    expect(mockUseComments).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, granularity: "week" }),
      expect.anything()
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <OperativnaPorocilaQrFeedback queryParams={{ od: "2026-09-01", do: "2026-09-04" }} />
      </QueryClientProvider>
    );

    expect(mockUseComments).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, do: "2026-09-04", granularity: "week" }),
      expect.anything()
    );
    expect(localStorage.getItem(QR_FEEDBACK_GRANULARITY_STORAGE_KEY)).toBe("week");
  });

  it("resets comment page to 1 when granularity changes", async () => {
    mockUseComments.mockImplementation(({ page }) => ({
      data: { ...commentsPage, page },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    }));
    renderComponent();
    fireEvent.click(screen.getByTestId("button-comments-next"));
    expect(mockUseComments).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, granularity: "day" }),
      expect.anything(),
    );
    fireEvent.click(screen.getByTestId("select-granularity"));
    fireEvent.click(await screen.findByTestId("select-option-week"));
    expect(mockUseComments).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, granularity: "week" }),
      expect.anything(),
    );
  });

  it("calls export API and triggers download on button click", async () => {
    mockExportFeedback.mockResolvedValue("Unit,Responses\nGlavna,12\n");
    
    renderComponent();
    const btn = screen.getByTestId("button-export-feedback");
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockExportFeedback).toHaveBeenCalledWith({
        od: "2026-09-01", do: "2026-09-03", granularity: "day",
      });
    });
  });
});
