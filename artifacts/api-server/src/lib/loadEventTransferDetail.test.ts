import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@workspace/db", () => ({
  pool: { query: queryMock },
}));

import { loadEventTransferDetail, loadEventTransferMovementDetail } from "./loadEventTransferDetail";

describe("loadEventTransferDetail", () => {
  beforeEach(() => queryMock.mockReset());

  it("omeji dogodek, prenose in vrstice na isto podjetje", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 20,
          name: "Festival",
          type: "festival",
          status: "active",
          location: "Park",
          customerName: null,
          startsAt: new Date("2026-09-04T08:00:00.000Z"),
          endsAt: new Date("2026-09-04T20:00:00.000Z"),
          notes: null,
          unitId: 1,
          unitName: "Glavna enota",
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          eventId: 20,
          direction: "outbound",
          status: "completed",
          sourceUnitId: 1,
          sourceUnitName: "Glavna enota",
          targetUnitId: 2,
          targetUnitName: "Dogodek",
          returnOfId: null,
          completedAt: new Date("2026-09-04T09:00:00.000Z"),
          createdAt: new Date("2026-09-04T08:30:00.000Z"),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 100,
          transferId: 10,
          sourceArticleId: 60,
          sourceArticleName: "Sok",
          targetArticleId: 61,
          targetArticleName: "Sok",
          quantity: "2.0000",
          unitCost: "3.000000",
          value: "6.0000000000",
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 501,
            articleId: 60,
            articleName: "Sok",
            type: "event_transfer_out",
            quantity: "-2",
            unitCost: "3",
            value: "-5",
            referenceId: 10,
            eventTransferId: 10,
          },
          {
            id: 502,
            articleId: 999,
            articleName: "Nepričakovan artikel",
            type: "event_transfer_in",
            quantity: "1",
            unitCost: "1",
            value: "1",
            referenceId: 10,
            eventTransferId: 10,
          },
        ],
      });

    const detail = await loadEventTransferDetail("company-1", 20);

    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(queryMock.mock.calls.map(call => call[1])).toEqual([
      ["company-1", 20],
      ["company-1", 20],
      ["company-1", [10]],
      ["company-1", [10]],
    ]);
    expect(detail).toMatchObject({
      readOnly: true,
      event: { id: 20, startsAt: "2026-09-04T08:00:00.000Z" },
      transfers: [{
        id: 10,
        lines: [{
          id: 100,
          sourceArticleName: "Sok",
          movements: [
            { state: "mismatch", movementId: 501, differences: ["value"] },
            { state: "missing", movementId: null },
          ],
        }],
        unexpectedMovements: [{
          movementId: 502,
          reason: "extra",
          actual: { articleName: "Nepričakovan artikel" },
        }],
      }],
    });
  });

  it("ne bere prenosov, ko dogodek v podjetju ne obstaja", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(loadEventTransferDetail("company-1", 99)).resolves.toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual(["company-1", 99]);
  });
});

describe("loadEventTransferMovementDetail", () => {
  beforeEach(() => queryMock.mockReset());

  it("vrne sled premika samo skozi enoto izbranega podjetja", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 501,
        articleId: 60,
        articleName: "Sok",
        unitId: 1,
        unitName: "Glavna enota",
        type: "event_transfer_out",
        quantity: "-2.0000",
        unitCost: "3.000000",
        value: "-6.0000",
        note: "Prenos na dogodek",
        actorSnapshot: "user_direct_456",
        sourceSnapshot: "pos_event_transfer",
        referenceId: 10,
        eventTransferId: 10,
        createdAt: new Date("2026-09-04T09:00:00.000Z"),
        transferId: 10,
        transferDirection: "outbound",
        transferStatus: "completed",
        transferCreatedBy: "user_123",
        eventId: 20,
        eventName: "Festival",
      }],
    });

    await expect(loadEventTransferMovementDetail("company-1", 501)).resolves.toMatchObject({
      readOnly: true,
      id: 501,
      createdAt: "2026-09-04T09:00:00.000Z",
      transferCreatedBy: "user_123",
      actorSnapshot: "user_direct_456",
      sourceSnapshot: "pos_event_transfer",
      eventId: 20,
    });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("JOIN enote e ON e.id=a.enota_id AND e.company_id=$1"),
      ["company-1", 501],
    );
    expect(queryMock.mock.calls[0][0]).toContain("pst.company_id=e.company_id");
    expect(queryMock.mock.calls[0][0]).toContain("pe.company_id=e.company_id");
  });

  it("vrne null za neobstoječ ali tuj premik", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(loadEventTransferMovementDetail("company-1", 999)).resolves.toBeNull();
  });
});