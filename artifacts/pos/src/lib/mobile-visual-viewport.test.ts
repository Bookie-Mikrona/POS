import { afterEach, describe, expect, it, vi } from "vitest";
import { setupMobileVisualViewport } from "./mobile-visual-viewport";

describe("mobilni VisualViewport brez Bookie ročice", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ne ustvari lastne ročice ali ščita za skrivanje tipkovnice", () => {
    cleanup = setupMobileVisualViewport();

    expect(document.querySelector("[data-pos-keyboard-dismiss-handle]")).toBeNull();
    expect(document.querySelector("[data-pos-keyboard-dismiss-shield]")).toBeNull();
  });

  it("še vedno pomakne fokusirano polje v vidno območje", () => {
    vi.useFakeTimers();
    cleanup = setupMobileVisualViewport();
    const input = document.createElement("input");
    input.scrollIntoView = vi.fn();
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
      top: 900,
      bottom: 940,
      left: 0,
      right: 100,
      width: 100,
      height: 40,
      x: 0,
      y: 900,
      toJSON: () => ({}),
    });
    document.body.appendChild(input);

    input.focus();
    vi.advanceTimersByTime(180);

    expect(input.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "smooth",
    });
  });
});