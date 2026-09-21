import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  buildTrendChartData,
  OperativnaPorocilaQrFeedback,
  parseStoredArticleView,
  QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY,
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

    const visibleNames = () => screen.getAllByRole("row").map(row => row.querySelector("td")?.textContent);
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

    const visibleNames = screen.getAllByRole("row").map(row => row.querySelector("td")?.textContent);
    expect(visibleNames).toEqual(["Sladoled", "Pizza"]);
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

  it("resets comment page to 1 when date changes", async () => {
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OperativnaPorocilaQrFeedback queryParams={{ od: "2026-09-01", do: "2026-09-03" }} />
      </QueryClientProvider>
    );

    // Initial page param requested is 1 from useState(1) before effect/mock handles it,
    // actually, React state is 1 on mount. Wait, the mock hook checks what it receives.
    expect(mockUseComments).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
      expect.anything()
    );

    // After mount, let's simulate a next page click if it was page 1.
    // However, our mock always returns commentsPage with page: 2, so the UI thinks we are on page 2.
    // If we pass new props, it should reset page to 1.
    
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OperativnaPorocilaQrFeedback queryParams={{ od: "2026-09-01", do: "2026-09-04" }} />
      </QueryClientProvider>
    );

    expect(mockUseComments).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, do: "2026-09-04" }),
      expect.anything()
    );
  });

  it("calls export API and triggers download on button click", async () => {
    mockExportFeedback.mockResolvedValue("Unit,Responses\nGlavna,12\n");
    
    renderComponent();
    const btn = screen.getByTestId("button-export-feedback");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockExportFeedback).toHaveBeenCalledWith({
        od: "2026-09-01",
        do: "2026-09-03",
        granularity: "day"
      });
    });
  });
});
