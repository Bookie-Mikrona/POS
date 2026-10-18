import { Children, cloneElement, isValidElement, type ComponentProps, type ReactElement } from "react";
import { vi } from "vitest";

// Keep API and chart mock factories in a dedicated module. Their implementations
// are unrelated and must not be combined when report test changes are merged.
const { mockUseFeedback, mockUseComments, mockExportFeedback } = vi.hoisted(() => ({
  mockUseFeedback: vi.fn(),
  mockUseComments: vi.fn(),
  mockExportFeedback: vi.fn(),
}));
export { mockUseFeedback, mockUseComments, mockExportFeedback };

vi.mock("@workspace/api-client-react", function mockQrReportApi() {
  return {
    useGetOperativnaPorocilaQrFeedback: mockUseFeedback,
    getGetOperativnaPorocilaQrFeedbackQueryKey: (params: unknown) => ["feedback", params],
    useGetOperativnaPorocilaQrFeedbackComments: mockUseComments,
    getGetOperativnaPorocilaQrFeedbackCommentsQueryKey: (params: unknown) => ["comments", params],
    exportOperativnaPorocilaQrFeedback: mockExportFeedback,
  };
});

// Exercise real Recharts SVG/legends. jsdom cannot measure containers or paths,
// so fix the chart size and disable line animations rather than mocking charts.
vi.mock("recharts", async function mockMeasuredQrCharts(importOriginal) {
  const charts = await importOriginal<typeof import("recharts")>();
  function FixedQrChartContainer({ children }: {
    children: ReactElement<ComponentProps<typeof charts.LineChart>>;
  }) {
    return cloneElement(children, { width: 640, height: 300 },
      Children.map(children.props.children, child =>
        isValidElement<{ isAnimationActive?: boolean }>(child) && child.type === charts.Line
          ? cloneElement(child, { isAnimationActive: false })
          : child));
  }
  return { ...charts, ResponsiveContainer: FixedQrChartContainer };
});
