import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CompanyWithRole } from "@workspace/api-client-react";
import { DocumentUpload } from "./document-upload";

const mocks = vi.hoisted(() => ({
  requestUpload: vi.fn(),
  registerDocument: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useRequestUploadUrl: () => ({ mutateAsync: mocks.requestUpload }),
  useRegisterDocument: () => ({ mutateAsync: mocks.registerDocument }),
  getListDocumentsQueryKey: (companyId: string) => ["documents", companyId],
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: mocks.trackEvent,
}));

const company = (id: string, role: "owner" | "accountant" | "viewer" = "owner") =>
  ({
    id,
    role,
    naziv: `Company ${id}`,
    kratekNaziv: `Short ${id}`,
  }) as CompanyWithRole;

function makeFile(name: string, type = "application/pdf", contents = "document") {
  return new File([contents], name, { type });
}

function renderUpload(activeCompany: CompanyWithRole | null = company("tenant-1")) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={queryClient}>
      <DocumentUpload company={activeCompany} />
    </QueryClientProvider>,
  );
  return { ...view, queryClient, invalidateQueries };
}

function selectFiles(files: File[]) {
  fireEvent.change(screen.getByLabelText("Izberite dokumente za nalaganje"), {
    target: { files },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.requestUpload.mockReset();
  mocks.registerDocument.mockReset();
  mocks.trackEvent.mockReset();
  mocks.requestUpload.mockImplementation(async ({ data }: { data: { name: string } }) => ({
    uploadURL: `https://storage.test/${data.name}`,
    objectPath: `objects/${data.name}`,
  }));
  mocks.registerDocument.mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DocumentUpload", () => {
  it("uploads each selected PDF/image with its own URL and registration, then invalidates that tenant's list", async () => {
    const timeline: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      timeline.push(`put:${(init.body as File).name}`);
      await Promise.resolve();
      timeline.push(`put-done:${(init.body as File).name}`);
      return { ok: true, status: 200 };
    });
    vi.stubGlobal("fetch", fetchMock);
    mocks.registerDocument.mockImplementation(async ({ data }: { data: { fileName: string } }) => {
      timeline.push(`register:${data.fileName}`);
    });
    const { queryClient, invalidateQueries } = renderUpload();
    const files = [
      makeFile("invoice.pdf", "application/pdf"),
      makeFile("receipt.png", "image/png"),
      makeFile("photo.jpg", "image/jpeg"),
    ];
    const input = screen.getByLabelText("Izberite dokumente za nalaganje") as HTMLInputElement;

    expect(input.multiple).toBe(true);
    selectFiles(files);

    await screen.findByText("Uspešno naloženih 3 od 3 dokumentov.");

    expect(mocks.requestUpload).toHaveBeenCalledTimes(3);
    expect(mocks.requestUpload).toHaveBeenNthCalledWith(1, {
      data: { name: "invoice.pdf", size: files[0].size, contentType: "application/pdf" },
    });
    expect(mocks.requestUpload).toHaveBeenNthCalledWith(2, {
      data: { name: "receipt.png", size: files[1].size, contentType: "image/png" },
    });
    expect(mocks.requestUpload).toHaveBeenNthCalledWith(3, {
      data: { name: "photo.jpg", size: files[2].size, contentType: "image/jpeg" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual(
      files.map(file => [`https://storage.test/${file.name}`, "PUT", file]),
    );
    expect(mocks.registerDocument).toHaveBeenCalledTimes(3);
    expect(mocks.registerDocument).toHaveBeenNthCalledWith(1, {
      companyId: "tenant-1",
      data: {
        objectPath: "objects/invoice.pdf",
        fileName: "invoice.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: files[0].size,
      },
    });
    expect(mocks.registerDocument).toHaveBeenNthCalledWith(2, {
      companyId: "tenant-1",
      data: {
        objectPath: "objects/receipt.png",
        fileName: "receipt.png",
        mimeType: "image/png",
        fileSizeBytes: files[1].size,
      },
    });
    expect(mocks.registerDocument).toHaveBeenNthCalledWith(3, {
      companyId: "tenant-1",
      data: {
        objectPath: "objects/photo.jpg",
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: files[2].size,
      },
    });
    for (const file of files) {
      expect(timeline.indexOf(`put-done:${file.name}`)).toBeLessThan(
        timeline.indexOf(`register:${file.name}`),
      );
    }
    expect(invalidateQueries.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ["documents", "tenant-1"],
      ["documents", "tenant-1"],
      ["documents", "tenant-1"],
    ]);
    expect(mocks.trackEvent).toHaveBeenCalledTimes(3);
    queryClient.clear();
  });

  it("isolates URL, PUT, and registration failures and continues the batch without retrying registration", async () => {
    mocks.requestUpload.mockImplementation(async ({ data }: { data: { name: string } }) => {
      if (data.name === "url-failure.pdf") throw new Error("URL unavailable");
      return { uploadURL: `https://storage.test/${data.name}`, objectPath: `objects/${data.name}` };
    });
    const fetchMock = vi.fn(async (url: string) => ({
      ok: !url.endsWith("put-failure.pdf"),
      status: url.endsWith("put-failure.pdf") ? 503 : 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.registerDocument.mockImplementation(async ({ data }: { data: { fileName: string } }) => {
      if (data.fileName === "register-failure.pdf") throw new Error("Register response lost");
    });
    const { queryClient, invalidateQueries } = renderUpload();

    selectFiles([
      makeFile("put-failure.pdf"),
      makeFile("url-failure.pdf"),
      makeFile("register-failure.pdf"),
      makeFile("success.pdf"),
    ]);

    await screen.findByText("Uspešno naloženih 1 od 4 dokumentov.");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("put-failure.pdf");
    expect(alert).toHaveTextContent("url-failure.pdf");
    expect(alert).toHaveTextContent("register-failure.pdf");
    expect(alert).toHaveTextContent("Registracije ni bilo mogoče potrditi");
    expect(alert).toHaveTextContent("preverite seznam dokumentov");
    expect(mocks.requestUpload).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mocks.registerDocument).toHaveBeenCalledTimes(2);
    expect(mocks.registerDocument).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fileName: "register-failure.pdf" }) }),
    );
    expect(mocks.registerDocument).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fileName: "success.pdf" }) }),
    );
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["documents", "tenant-1"] });
    queryClient.clear();
  });

  it("disables input while pending, warns before unload, and keeps the originally selected tenant", async () => {
    const put = deferred<{ ok: boolean; status: number }>();
    const fetchMock = vi.fn(() => put.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { queryClient, invalidateQueries, rerender } = renderUpload(company("tenant-original"));
    const file = makeFile("pending.pdf");

    selectFiles([file]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText("Izberite dokumente za nalaganje") as HTMLInputElement;
    const button = screen.getByRole("button", { name: /Nalaganje 1\/1/ });
    expect(input).toBeDisabled();
    expect(button).toBeDisabled();
    expect(screen.getByText("Obravnavanih 0 od 1")).toBeInTheDocument();
    expect(screen.getByText("pending.pdf")).toBeInTheDocument();
    const beforeUpload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUpload);
    expect(beforeUpload.defaultPrevented).toBe(true);

    rerender(
      <QueryClientProvider client={queryClient}>
        <DocumentUpload company={company("tenant-next")} />
      </QueryClientProvider>,
    );
    await act(async () => {
      put.resolve({ ok: true, status: 200 });
    });

    expect(await screen.findByText("Uspešno naloženih 1 od 1 dokumentov.")).toBeInTheDocument();
    expect(mocks.registerDocument).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "tenant-original" }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["documents", "tenant-original"] });
    expect(screen.getByText("Naloženi dokumenti se nato ločeno obdelajo z AI.")).toBeInTheDocument();
    const afterUpload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterUpload);
    expect(afterUpload.defaultPrevented).toBe(false);
    queryClient.clear();
  });

  it("does no work for empty selections or when the selected company is absent or read-only", async () => {
    const { queryClient, rerender } = renderUpload();
    selectFiles([]);
    expect(mocks.requestUpload).not.toHaveBeenCalled();
    expect(mocks.registerDocument).not.toHaveBeenCalled();

    rerender(
      <QueryClientProvider client={queryClient}>
        <DocumentUpload company={company("viewer-tenant", "viewer")} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Naloži dokumente" })).toBeDisabled();
    selectFiles([makeFile("viewer.pdf")]);
    expect(mocks.requestUpload).not.toHaveBeenCalled();

    rerender(
      <QueryClientProvider client={queryClient}>
        <DocumentUpload company={null} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Naloži dokumente" })).toBeDisabled();
    selectFiles([makeFile("no-company.pdf")]);
    expect(mocks.requestUpload).not.toHaveBeenCalled();
    expect(mocks.registerDocument).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it("normalizes an empty MIME from the extension and rejects empty or unsupported files locally", async () => {
    const { queryClient } = renderUpload();

    selectFiles([
      makeFile("SCANNED.PDF", "", "pdf bytes"),
      makeFile("notes.txt", "text/plain"),
      makeFile("empty.pdf", "application/pdf", ""),
    ]);

    await screen.findByText("Uspešno naloženih 1 od 3 dokumentov.");

    expect(mocks.requestUpload).toHaveBeenCalledTimes(1);
    expect(mocks.requestUpload).toHaveBeenCalledWith({
      data: {
        name: "SCANNED.PDF",
        size: 9,
        contentType: "application/pdf",
      },
    });
    expect(mocks.registerDocument).toHaveBeenCalledTimes(1);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("notes.txt");
    expect(alert).toHaveTextContent("Podprti so PDF, JPG, PNG in WEBP.");
    expect(alert).toHaveTextContent("empty.pdf");
    expect(alert).toHaveTextContent("Datoteka je prazna.");
    queryClient.clear();
  });

  it("resets the file input and allows the same file to be selected again after completion", async () => {
    const { queryClient } = renderUpload();
    const file = makeFile("repeat.pdf");
    const input = screen.getByLabelText("Izberite dokumente za nalaganje") as HTMLInputElement;

    selectFiles([file]);
    await screen.findByText("Uspešno naloženih 1 od 1 dokumentov.");
    expect(input.value).toBe("");

    selectFiles([file]);
    await waitFor(() => expect(mocks.requestUpload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.registerDocument).toHaveBeenCalledTimes(2));
    expect(input.value).toBe("");
    queryClient.clear();
  });
});