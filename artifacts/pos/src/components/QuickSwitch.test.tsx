import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickSwitch } from "./QuickSwitch";
import { POS_ACTOR_SESSION_REQUIRED_EVENT } from "@/lib/pos-actor-session";

const mockPosFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pos-auth-headers", () => ({
  posFetch: mockPosFetch,
}));

describe("QuickSwitch", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    mockPosFetch.mockReset();
  });

  it("brez actor seje omogoči dostop do nastavitev in ponudi izbiro natakarja", () => {
    render(<QuickSwitch />);

    const openButton = screen.getByRole("button", { name: /izberi natakarja/i });
    expect(openButton).toBeInTheDocument();
    expect(openButton).toHaveClass("z-40");
    expect(openButton).not.toHaveClass("z-[90]");
    expect(screen.queryByText("Hitra menjava natakarja")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /izberi natakarja/i }));
    expect(screen.getByText("Hitra menjava natakarja")).toBeInTheDocument();
    expect(screen.getByText(/izberite natakarja z aktivno izmeno/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("ID natakarja")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /polna prijava/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /zakleni pos/i })).not.toBeInTheDocument();
  });

  it("omogoči izhod iz izbire natakarja brez ERP prijave", () => {
    render(<QuickSwitch />);

    fireEvent.click(screen.getByRole("button", { name: /izberi natakarja/i }));
    fireEvent.click(screen.getByRole("button", { name: /prekliči/i }));

    expect(screen.queryByText("Hitra menjava natakarja")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /izberi natakarja/i })).toBeInTheDocument();
  });

  it("ob pozivu občutljivega dejanja takoj odpre vnos PIN-a", () => {
    sessionStorage.setItem("pos_actor_session", "actor-token");
    localStorage.setItem("pos_last_natakar_id", "8");
    render(<QuickSwitch />);

    sessionStorage.removeItem("pos_actor_session");
    act(() => {
      window.dispatchEvent(new Event(POS_ACTOR_SESSION_REQUIRED_EVENT));
    });

    expect(screen.getByText("Hitra menjava natakarja")).toBeInTheDocument();
    expect(screen.getByText("Natakar ID: 8")).toBeInTheDocument();
    expect(screen.queryByLabelText("ID natakarja")).not.toBeInTheDocument();
    expect(screen.queryByText("Natakarji z odprto izmeno")).not.toBeInTheDocument();
    const pinInput = screen.getByLabelText("PIN");
    expect(pinInput).toHaveFocus();
    expect(pinInput).toHaveAttribute("inputmode", "numeric");
    fireEvent.change(pinInput, { target: { value: "12a34" } });
    expect(pinInput).toHaveValue("1234");
  });

  it("po uspešnem PIN preklopu shrani sejo in odklene POS", async () => {
    mockPosFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/izmene/aktivne")) {
        return {
          ok: true,
          json: () => Promise.resolve([
            { natakariId: 7, natakarIme: "Ana Novak", konec: null },
          ]),
        };
      }
      return {
        ok: true,
        json: () => Promise.resolve({ token: "actor-token" }),
      };
    });
    render(<QuickSwitch />);

    fireEvent.click(screen.getByRole("button", { name: /izberi natakarja/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Ana Novak" }));
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: /odkleni in preklopi/i }));

    await waitFor(() => {
      expect(sessionStorage.getItem("pos_actor_session")).toBe("actor-token");
      expect(localStorage.getItem("pos_last_operator_id")).toBe("7");
      expect(screen.getByRole("button", { name: /zamenjaj natakarja/i })).toBeInTheDocument();
    });
    expect(mockPosFetch).toHaveBeenCalledWith("/api/quick-switch/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ natakarId: 7, pin: "1234" }),
    });
  });

  it("ob napačnem PIN-u ohrani starega potrjenega natakarja in actor token", async () => {
    localStorage.setItem("pos_last_operator_id", "7");
    localStorage.setItem("pos_last_natakar_id", "829");
    sessionStorage.setItem("pos_actor_session", "old-actor-token");
    mockPosFetch.mockImplementation(async () => {
      return {
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "PIN ni veljaven." }),
      };
    });
    render(<QuickSwitch />);
    act(() => {
      window.dispatchEvent(new Event(POS_ACTOR_SESSION_REQUIRED_EVENT));
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "0406" } });
    fireEvent.click(screen.getByRole("button", { name: /odkleni in preklopi/i }));

    await waitFor(() => {
      expect(screen.getByText("PIN ni veljaven.")).toBeInTheDocument();
    });
    expect(sessionStorage.getItem("pos_actor_session")).toBe("old-actor-token");
    expect(localStorage.getItem("pos_last_operator_id")).toBe("7");

    fireEvent.click(screen.getByRole("button", { name: /prekliči/i }));
    expect(localStorage.getItem("pos_last_natakar_id")).toBe("7");
    expect(localStorage.getItem("pos_last_operator_id")).toBe("7");
  });

  it("ob ročnem odprtju kljub zapomnjenemu ID-ju ponudi izbiro aktivnega natakarja", async () => {
    localStorage.setItem("pos_last_natakar_id", "829");
    mockPosFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { natakariId: 7, natakarIme: "Ana Novak", konec: null },
        { natakariId: 829, natakarIme: "Boris Kovač", konec: null },
      ]),
    });
    render(<QuickSwitch />);

    fireEvent.click(screen.getByRole("button", { name: /izberi natakarja/i }));
    expect(await screen.findByRole("button", { name: "Ana Novak" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Boris Kovač" })).toBeInTheDocument();
    expect(screen.queryByLabelText("ID natakarja")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("PIN")).not.toBeInTheDocument();
  });

  it("ob dotiku začetnega gumba prepreči, da bi mobilni brskalnik po izrisu odvzel fokus PIN-u", () => {
    localStorage.setItem("pos_last_natakar_id", "829");
    render(<QuickSwitch />);

    const openButton = screen.getByRole("button", { name: /izberi natakarja/i });
    expect(fireEvent.pointerDown(openButton)).toBe(false);
    fireEvent.click(openButton);

    expect(screen.queryByLabelText("ID natakarja")).not.toBeInTheDocument();
    expect(screen.getByText("Hitra menjava natakarja").closest("[data-pos-keyboard-overlay]"))
      .toHaveAttribute("data-pos-keyboard-autofocus-disabled");
  });

  it("ob nepojasnjeni mobilni izgubi fokusa PIN takoj znova zadrži fokus", () => {
    localStorage.setItem("pos_last_natakar_id", "829");
    render(<QuickSwitch />);
    sessionStorage.setItem("pos_actor_session", "actor-token");
    sessionStorage.removeItem("pos_actor_session");
    act(() => {
      window.dispatchEvent(new Event(POS_ACTOR_SESSION_REQUIRED_EVENT));
    });
    const pinInput = screen.getByLabelText("PIN");

    fireEvent.blur(pinInput, { relatedTarget: null });

    expect(pinInput).toHaveFocus();
  });

  it("ob Android prehodu fokusa na body PIN takoj znova zadrži fokus", () => {
    localStorage.setItem("pos_last_natakar_id", "829");
    render(<QuickSwitch />);
    act(() => {
      window.dispatchEvent(new Event(POS_ACTOR_SESSION_REQUIRED_EVENT));
    });
    const pinInput = screen.getByLabelText("PIN");

    fireEvent.blur(pinInput, { relatedTarget: document.body });

    expect(pinInput).toHaveFocus();
  });

  it("iz PIN pogleda omogoči vrnitev na seznam aktivnih natakarjev", async () => {
    localStorage.setItem("pos_last_natakar_id", "829");
    mockPosFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { natakariId: 7, natakarIme: "Ana Novak", konec: null },
      ]),
    });
    render(<QuickSwitch />);
    act(() => {
      window.dispatchEvent(new Event(POS_ACTOR_SESSION_REQUIRED_EVENT));
    });
    fireEvent.click(screen.getByRole("button", { name: /izberi drugega natakarja/i }));

    expect(await screen.findByRole("button", { name: "Ana Novak" })).toBeInTheDocument();
    expect(screen.queryByLabelText("ID natakarja")).not.toBeInTheDocument();
  });

  it("če ni aktivnih izmen ne ponudi ročnega vnosa ID-ja", async () => {
    mockPosFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    render(<QuickSwitch />);
    fireEvent.click(screen.getByRole("button", { name: /izberi natakarja/i }));

    expect(await screen.findByText(/ni natakarjev z aktivno izmeno/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("ID natakarja")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("PIN")).not.toBeInTheDocument();
  });

  it("pri prekrivanju izmen omogoči hiter izbor natakarja z odprto izmeno", async () => {
    mockPosFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/izmene/aktivne")) {
        return {
          ok: true,
          json: () => Promise.resolve([
            { natakariId: 7, natakarIme: "Ana Novak", konec: null },
            { natakariId: 8, natakarIme: "Boris Kovač", konec: null },
          ]),
        };
      }
      return {
        ok: true,
        json: () => Promise.resolve({ token: "boris-actor-token" }),
      };
    });
    render(<QuickSwitch />);
    fireEvent.click(screen.getByRole("button", { name: /izberi natakarja/i }));

    fireEvent.click(await screen.findByRole("button", { name: "Boris Kovač" }));
    await waitFor(() => expect(screen.getByLabelText("PIN")).toHaveFocus());
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "5678" } });
    fireEvent.click(screen.getByRole("button", { name: /odkleni in preklopi/i }));

    await waitFor(() => {
      expect(sessionStorage.getItem("pos_actor_session")).toBe("boris-actor-token");
    });
    expect(mockPosFetch).toHaveBeenCalledWith("/api/quick-switch/switch", expect.objectContaining({
      body: JSON.stringify({ natakarId: 8, pin: "5678" }),
    }));
  });
});