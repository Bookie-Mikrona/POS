import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getNormativStaleMessage, NormativSaveAlert } from "./NormativSaveAlert";

describe("NormativSaveAlert", () => {
  it("prepozna samo namenski 409 konflikt normativa", () => {
    expect(getNormativStaleMessage({
      status: 409,
      data: { code: "NORMATIVE_STALE", error: "Normativ je novejši." },
    })).toBe("Normativ je novejši.");
    expect(getNormativStaleMessage({ status: 409, data: null })).toBeNull();
    expect(getNormativStaleMessage({
      status: 422,
      data: { code: "NORMATIVE_STALE", error: "Normativ je novejši." },
    })).toBeNull();
  });

  it("ob konfliktu ponudi osvežitev in je ne sproži samodejno", () => {
    const onRefresh = vi.fn();
    render(
      <NormativSaveAlert
        message="Normativ se je medtem spremenil."
        stale
        refreshing={false}
        onRefresh={onRefresh}
      />,
    );

    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Osveži normativ" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});