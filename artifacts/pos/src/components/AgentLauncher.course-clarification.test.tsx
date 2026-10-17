import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentLauncher,
  CourseClarificationChoices,
  isAgentCourseMutationAction,
  isAgentOrderMutationAction,
} from "./AgentLauncher";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/narocilo/42", vi.fn()],
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { enotaId: 7 } }),
}));
vi.mock("@/contexts/NapravaContext", () => ({
  useNaprava: () => ({
    naprava: {
      terminalConfig: { aiSvetovalecAktiven: true },
      aiAccessToken: "ai-device-token",
    },
    napravaKljuc: "test-device",
  }),
}));
vi.mock("@/hooks/use-glasovni-ukaz", () => ({
  jePodprtGlasovniVnos: () => false,
  useGlasovniUkaz: () => ({
    poslusam: false,
    zacni: vi.fn(),
    ustavi: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@workspace/api-client-react", () => ({
  getAuthToken: () => Promise.resolve("clerk-token"),
  getEnotaId: () => 7,
  getListAktivneIzmeneQueryKey: () => ["/api/izmene/aktivne"],
  getListIzmeneQueryKey: () => ["/api/izmene"],
  getListNarocilaQueryKey: () => ["/api/narocila"],
  getListAktivnaNarocilaQueryKey: () => ["/api/narocila/aktivna"],
  getGetNarociloQueryKey: (id: number) => [`/api/narocila/${id}`],
}));

beforeEach(() => {
  mocks.invalidateQueries.mockReset();
  mocks.invalidateQueries.mockResolvedValue(undefined);
  sessionStorage.setItem("pos_actor_session", "actor-session");
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("CourseClarificationChoices", () => {
  it("prikaže konkretna imena in pošlje izbrano številko hoda", () => {
    const onSelect = vi.fn();
    render(
      <CourseClarificationChoices
        clarification={{
          token: "batch-token",
          options: [
            { courseNumber: 2, courseName: "Ribji hod" },
            { courseNumber: 3, courseName: "Ribji posebni hod" },
          ],
        }}
        currentToken="batch-token"
        loading={false}
        onSelect={onSelect}
      />,
    );

    expect((screen.getByRole("button", { name: "Ribji hod (2)" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Ribji posebni hod (3)" }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("onemogoči stare možnosti, ko token ni več aktualen", () => {
    render(
      <CourseClarificationChoices
        clarification={{ token: "old", options: [{ courseNumber: 2, courseName: "Ribji hod" }] }}
        currentToken="new"
        loading={false}
        onSelect={() => undefined}
      />,
    );
    expect((screen.getByRole("button", { name: "Ribji hod (2)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("paketno dodelitev obravnava kot zaključeno naročilno in KDS mutacijo", () => {
    expect(isAgentOrderMutationAction("assign_courses")).toBe(true);
    expect(isAgentCourseMutationAction("assign_courses")).toBe(true);
  });

  it("po izbiri hoda pošlje token, označi paket kot izveden in osveži naročilo ter KDS", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ history: [], memory: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: "explain",
          odgovor: "Izberite ribji hod.",
          courseClarification: {
            token: "v2-signed-batch-token",
            options: [
              { courseNumber: 2, courseName: "Ribji hod" },
              { courseNumber: 3, courseName: "Ribji posebni hod" },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: "assign_courses",
          odgovor: "Juha je na prvem hodu, vino pa na tretjem.",
          narociloId: 42,
          changed: true,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentLauncher />);
    fireEvent.click(screen.getAllByRole("button")[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/ai/agent/history");
    fireEvent.change(await screen.findByPlaceholderText("Vpišite ukaz..."), {
      target: { value: "vino k ribjemu hodu, juha na prvi hod" },
    });
    fireEvent.submit(screen.getByPlaceholderText("Vpišite ukaz...").closest("form")!);

    fireEvent.click(await screen.findByRole("button", { name: "Ribji posebni hod (3)" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/ai/agent");
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer clerk-token",
        "X-Enota-Id": "7",
        "X-Naprava-Id": "test-device",
        "X-AI-Device-Token": "ai-device-token",
        "X-Pos-Actor-Session": "actor-session",
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toMatchObject({
      ukaz: "vino k ribjemu hodu, juha na prvi hod",
      narociloId: 42,
    });
    expect(fetchMock.mock.calls[2]![0]).toBe("/api/ai/agent");
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer clerk-token",
        "X-Enota-Id": "7",
        "X-Naprava-Id": "test-device",
        "X-AI-Device-Token": "ai-device-token",
        "X-Pos-Actor-Session": "actor-session",
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[2]![1]!.body as string)).toMatchObject({
      ukaz: "3",
      narociloId: 42,
      courseClarificationToken: "v2-signed-batch-token",
    });
    expect(await screen.findByText("Izvedeno:")).toBeTruthy();
    expect(screen.getAllByText("Juha je na prvem hodu, vino pa na tretjem.")).toHaveLength(2);

    await waitFor(() => {
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/narocila"] });
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/narocila/aktivna"] });
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/narocila/42"] });
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["kds"] });
    });
  });

  it("kaže le naslednjo izbiro in osveži POS ter KDS šele po zadnji", async () => {
    const response = (data: unknown) => ({ ok: true, json: async () => data });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ history: [], memory: [] }))
      .mockResolvedValueOnce(response({
        action: "explain", odgovor: "Izberite hod za vino.",
        courseClarification: { token: "step-1", options: [{ courseNumber: 2, courseName: "Ribji hod" }] },
      }))
      .mockResolvedValueOnce(response({
        action: "explain", odgovor: "Izberite hod za juho. Paket še ni izveden.",
        courseClarification: { token: "step-2", options: [{ courseNumber: 4, courseName: "Topli hod" }] },
      }))
      .mockResolvedValueOnce(response({
        action: "assign_courses", odgovor: "Celoten paket je izveden.", narociloId: 42, changed: true,
      }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentLauncher />);
    fireEvent.click(screen.getAllByRole("button")[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(await screen.findByPlaceholderText("Vpišite ukaz..."), {
      target: { value: "vino k ribjemu hodu, juha k toplemu hodu" },
    });
    fireEvent.submit(screen.getByPlaceholderText("Vpišite ukaz...").closest("form")!);
    fireEvent.click(await screen.findByRole("button", { name: "Ribji hod (2)" }));
    const next = await screen.findByRole("button", { name: "Topli hod (4)" });
    expect(screen.queryByRole("button", { name: "Ribji hod (2)" })).toBeNull();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(screen.queryByText("Izvedeno:")).toBeNull();
    fireEvent.click(next);
    await screen.findByText("Izvedeno:");
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toMatchObject({ ukaz: "2", courseClarificationToken: "step-1" });
    expect(JSON.parse(fetchMock.mock.calls[3]![1].body)).toMatchObject({ ukaz: "4", courseClarificationToken: "step-2" });
    expect(screen.queryByRole("button", { name: "Topli hod (4)" })).toBeNull();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["kds"] });
  });
});