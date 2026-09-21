import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: queryMock },
}));

import { loadEventTransferDiagnostics } from "./loadEventTransferDiagnostics";

describe("loadEventTransferDiagnostics", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("imena prebere množično in ne izvaja poizvedbe za vsako kršitev", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          eventId: 20,
          direction: "outbound",
          status: "completed",
          sourceUnitId: 30,
          targetUnitId: 40,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 50,
          transferId: 10,
          sourceArticleId: 60,
          targetArticleId: 70,
          quantity: "2",
          unitCost: "3",
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ id: 20, name: "Festival ob jezeru" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 30, name: "Glavna kuhinja" },
          { id: 40, name: "Prireditveni šotor" },
        ],
        rowCount: 2,
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 60, name: "Sok jabolko" },
          { id: 70, name: "Sok jabolko — dogodek" },
        ],
        rowCount: 2,
      });

    const report = await loadEventTransferDiagnostics("company-1", 40);

    expect(report.violationCount).toBe(2);
    expect(queryMock).toHaveBeenCalledTimes(6);
    expect(queryMock.mock.calls[3][1]).toEqual(["company-1", [20]]);
    expect(queryMock.mock.calls[4][1]).toEqual(["company-1", [30, 40]]);
    expect(queryMock.mock.calls[5][1]).toEqual(["company-1", [60, 70]]);
    expect(report.violations).toEqual([
      expect.objectContaining({
        eventName: "Festival ob jezeru",
        sourceUnitName: "Glavna kuhinja",
        targetUnitName: "Prireditveni šotor",
        expected: expect.objectContaining({
          articleId: 60,
          articleName: "Sok jabolko",
        }),
      }),
      expect.objectContaining({
        expected: expect.objectContaining({
          articleId: 70,
          articleName: "Sok jabolko — dogodek",
        }),
      }),
    ]);
  });
});