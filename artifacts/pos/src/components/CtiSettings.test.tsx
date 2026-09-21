import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { CtiSettings } from "./CtiSettings";

const toast = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

describe("CtiSettings", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (url.includes("/cti/token/generiraj") && options?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ ctiToken: "nov-cti-token-za-enoto" }), { status: 200 }));
      }
      if (url.includes("/cti/token")) {
        return Promise.resolve(new Response(JSON.stringify({ ctiToken: "obstojeci-cti-token" }), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("žeton najprej prikaže maskirano, ga razkrije in kopira z aktivno enoto v glavi", async () => {
    render(<CtiSettings enotaId={7} />);
    const tokenInput = await screen.findByLabelText("CTI žeton");

    expect(tokenInput).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Prikaži CTI žeton" }));
    expect(tokenInput).toHaveAttribute("type", "text");

    fireEvent.click(screen.getAllByRole("button", { name: "Kopiraj" })[0]);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("obstojeci-cti-token"));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/cti/token"),
      expect.objectContaining({ headers: { "X-Enota-Id": "7" } }),
    );
  });

  it("ob potrditvi regeneracije prikaže nov žeton in ne pošilja enotaId v telesu", async () => {
    render(<CtiSettings enotaId={7} />);
    await screen.findByLabelText("CTI žeton");

    fireEvent.click(screen.getByRole("button", { name: "Regeneriraj žeton" }));
    expect(await screen.findByText("Regeneriram CTI žeton?")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Regeneriraj žeton" }));

    await waitFor(() => expect(screen.getByLabelText("CTI žeton")).toHaveValue("nov-cti-token-za-enoto"));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/cti/token/generiraj"),
      expect.objectContaining({
        method: "POST",
        headers: { "X-Enota-Id": "7" },
      }),
    );
  });
});