import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NormativeChangeHistoryPanel } from "./NormativeChangeHistoryPanel";

describe("NormativeChangeHistoryPanel", () => {
  it("pokaže čas, izvajalca, sestavino, količini in javni vir", () => {
    render(
      <NormativeChangeHistoryPanel
        isLoading={false}
        isError={false}
        items={[{
          id: 7,
          changedAt: "2026-09-07T08:15:00.000Z",
          actorClerkUserId: "user_123",
          actorNatakarId: 4,
          actorName: "Ana Novak",
          ingredientId: 11,
          ingredientName: "Moka",
          oldQuantity: 100,
          newQuantity: 125.5,
          unit: "g",
          sourceUrl: "https://www.kulinarika.net/recept/test",
          sourceTitle: "Javni recept",
          comparisonGeneratedAt: "2026-09-07T08:00:00.000Z",
        }]}
      />,
    );

    expect(screen.getByText("Ana Novak")).toBeTruthy();
    expect(screen.getByText("Moka")).toBeTruthy();
    expect(screen.getByText(/100 g/)).toBeTruthy();
    expect(screen.getByText(/125,5 g/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Javni recept/ }).getAttribute("href"))
      .toBe("https://www.kulinarika.net/recept/test");
    expect(screen.getByRole("time").getAttribute("datetime")).toBe("2026-09-07T08:15:00.000Z");
  });
});