import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Simulate the Recharts hover contract: tooltip receives the value identified
// by the categorical X axis, or the numeric point index if none is configured.
vi.mock("recharts", async () => {
  const React = await import("react");
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    LineChart: ({ children, data }: { children: React.ReactNode; data: Array<Record<string, unknown>> }) => {
      const [label, setLabel] = React.useState<string | number | null>(null);
      const elements = React.Children.toArray(children).filter(React.isValidElement);
      const axis = elements.find(child => child.type === "test-x-axis");
      const tooltip = elements.find(child => child.type === "test-tooltip");
      const axisKey = (axis?.props as { dataKey?: string } | undefined)?.dataKey;
      const formatLabel = (tooltip?.props as { labelFormatter?: (value: string | number) => string } | undefined)?.labelFormatter;
      return (
        <div data-testid="line-chart" onMouseMove={() => setLabel(axisKey ? data[0][axisKey] as string : 0)}>
          {label !== null && <span>{formatLabel?.(label)}</span>}
        </div>
      );
    },
    XAxis: "test-x-axis",
    Tooltip: "test-tooltip",
    Line: "test-line",
    BarChart: "test-bar-chart",
    Bar: "test-bar",
    Cell: "test-cell",
    YAxis: "test-y-axis",
    CartesianGrid: "test-grid",
  };
});

import { BankBalanceSparkline } from "./dashboard";

describe("bančni trend", () => {
  it("uses the date rather than a numeric index for the hover label", () => {
    render(<BankBalanceSparkline points={[
      { date: "2026-09-01", balance: 100 },
      { date: "2026-09-02", balance: 140 },
    ]} />);
    const chart = screen.getByTestId("line-chart");
    fireEvent.mouseMove(chart);
    expect(chart.textContent).toBe("01.09.2026");
  });
});