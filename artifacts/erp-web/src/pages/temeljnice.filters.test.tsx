import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const api = vi.hoisted(() => ({
  listEntries: vi.fn(),
  company: { id: "company-filters", role: "owner" },
  periods: { periods: [
    { id: "current", name: "Tekoče obdobje", status: "open", startDate: "2026-01-01", endDate: "2026-12-31" },
    { id: "previous", name: "Preteklo obdobje", status: "closed", startDate: "2025-01-01", endDate: "2025-12-31" },
  ] },
  costCenters: { costCenters: [{ id: "cc", name: "Uprava" }] },
  projects: { projects: [{ id: "project", name: "Prenova" }] },
  departments: { departments: [{ id: "department", name: "Računovodstvo" }] },
  pending: { entries: [{ id: "monthly", reference: "POS:PRODAJA:2026-09:E1", status: "draft" }] },
  empty: { entries: [] },
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken: vi.fn().mockResolvedValue("test-token") }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: api.company }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useListJournalEntries: (...args: unknown[]) => {
    api.listEntries(...args);
    // The badge has a separate, unfiltered draft query; don't mistake it for the list.
    const params = args[1] as Record<string, unknown>;
    return { data: Object.keys(params).length === 1 ? api.pending : api.empty, isLoading: false };
  },
  useGetJournalEntry: () => ({}),
  useListPeriods: () => ({ data: api.periods, isSuccess: true, isFetching: false }),
  useListCostCenters: () => ({ data: api.costCenters, isSuccess: true, isFetching: false }),
  useListProjects: () => ({ data: api.projects, isSuccess: true, isFetching: false }),
  useListDepartments: () => ({ data: api.departments, isSuccess: true, isFetching: false }),
  usePostJournalEntry: () => ({}),
  useDeleteJournalEntry: () => ({}),
}));

import Temeljnice from "./temeljnice";

const key = `bookie:journal-filters:${api.company.id}`;
const selected = {
  periodFilter: "previous",
  entryKindFilter: "monthly-pos",
  statusFilter: "posted",
  costCenterFilter: "cc",
  projectFilter: "project",
  departmentFilter: "department",
};
const all = {
  periodFilter: "all",
  entryKindFilter: "all",
  statusFilter: "all",
  costCenterFilter: "all",
  projectFilter: "all",
  departmentFilter: "all",
};
const selectedLabels = ["Preteklo obdobje", "Mesečni POS osnutki", "Knjiženo", "Uprava", "Prenova", "Računovodstvo"];
const allLabels = ["Vsa obdobja", "Vse temeljnice", "Vsi statusi", "Vsa stroškovna mesta", "Vsi projekti", "Vsi oddelki"];
const unfilteredParams = {
  periodId: undefined,
  status: undefined,
  costCenterId: undefined,
  projectId: undefined,
  departmentId: undefined,
};
let client: QueryClient;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");

beforeEach(() => {
  localStorage.clear();
  api.listEntries.mockClear();
  // Radix focuses and scrolls options; jsdom has no layout/scroll implementation.
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
  if (originalScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  localStorage.clear();
});

function openPage() {
  const location = memoryLocation({ path: "/temeljnice" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Router hook={location.hook}>
        <nav>
          <Link href="/drugam">Zapusti temeljnice</Link>
          <Link href="/temeljnice">Odpri temeljnice</Link>
        </nav>
        <Route path="/temeljnice"><Temeljnice /></Route>
        <Route path="/drugam"><h1>Druga stran</h1></Route>
      </Router>
    </QueryClientProvider>,
  );
}

async function choose(currentLabel: string, nextLabel: string) {
  // Keep the real Radix Select (including its portal and value-change wiring).
  const trigger = screen.getAllByRole("combobox").find(el => el.textContent === currentLabel);
  expect(trigger).toBeDefined();
  fireEvent.keyDown(trigger!, { key: "Enter" });
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: nextLabel }));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
}

async function selectEveryFilter() {
  const labels = screen.getAllByRole("combobox").map(el => el.textContent!);
  expect(labels).toHaveLength(6);
  for (let index = 0; index < labels.length; index++) {
    await choose(labels[index]!, selectedLabels[index]!);
  }
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(selected);
}

function expectSelections(labels: string[]) {
  expect(screen.getAllByRole("combobox").map(el => el.textContent)).toEqual(labels);
}

function listCalls() {
  return api.listEntries.mock.calls.filter(([, params]) => Object.hasOwn(params, "periodId"));
}

function expectListParams(params: typeof unfilteredParams | Record<string, unknown>, everyCall = false) {
  const calls = listCalls();
  expect(calls.length).toBeGreaterThan(0);
  for (const call of everyCall ? calls : calls.slice(-1)) {
    expect(call).toEqual([api.company.id, params, { query: { enabled: true } }]);
  }
}

function leaveAndReturn() {
  fireEvent.click(screen.getByRole("link", { name: "Zapusti temeljnice" }));
  expect(screen.getByRole("heading", { name: "Druga stran" })).toBeInTheDocument();
  expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  api.listEntries.mockClear();
  fireEvent.click(screen.getByRole("link", { name: "Odpri temeljnice" }));
  expect(screen.getByRole("heading", { name: "Temeljnice" })).toBeInTheDocument();
}

describe("Temeljnice – filtri prek dejanskih izbirnikov", () => {
  it("po odhodu in vrnitvi obnovi vseh šest izbir in že prvi seznam poizveduje z obnovljenimi parametri", async () => {
    openPage();
    await selectEveryFilter();
    const params = {
      periodId: "previous", status: "posted", costCenterId: "cc",
      projectId: "project", departmentId: "department",
    };
    expectSelections(selectedLabels);
    expectListParams(params);

    leaveAndReturn();
    expectSelections(selectedLabels);
    expectListParams(params, true);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(selected);
  });

  it("Počisti filtre hkrati ponastavi vse izbire in odstrani shranjeno kombinacijo", async () => {
    openPage();
    await selectEveryFilter();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    api.listEntries.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Počisti filtre" }));

    expectSelections(allLabels);
    expectListParams(unfilteredParams, true);
    expect(localStorage.getItem(key)).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem.mock.calls).toEqual([[key]]);
    expect(screen.queryByRole("button", { name: "Počisti filtre" })).not.toBeInTheDocument();

    // Clearing removes the preference: reopening uses the default accounting period.
    leaveAndReturn();
    expectSelections(["Tekoče obdobje", ...allLabels.slice(1)]);
    expectListParams({ ...unfilteredParams, periodId: "current" }, true);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("Prikaži osnutke shrani eno atomsko kombinacijo brez prejšnjih dimenzij in jo obnovi ob vrnitvi", async () => {
    openPage();
    await selectEveryFilter();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    api.listEntries.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Prikaži osnutke" }));

    const drafts = { ...all, statusFilter: "draft", entryKindFilter: "monthly-pos" };
    const labels = [...allLabels];
    labels[1] = "Mesečni POS osnutki";
    labels[2] = "Osnutek";
    const params = { ...unfilteredParams, status: "draft" };
    expectSelections(labels);
    expectListParams(params, true);
    expect(setItem.mock.calls.map(([storageKey, value]) => [storageKey, JSON.parse(value)]))
      .toEqual([[key, drafts]]);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(drafts);

    leaveAndReturn();
    expectSelections(labels);
    expectListParams(params, true);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(drafts);
  });
});
