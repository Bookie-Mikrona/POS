import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JavnaStran from "./JavnaStran";

const apiMocks = vi.hoisted(() => ({
  requestUpload: vi.fn(),
  deleteImage: vi.fn(),
  update: vi.fn(),
  toast: vi.fn(),
}));

const companyId = "11111111-1111-4111-8111-111111111111";
const firstObjectId = "22222222-2222-4222-8222-222222222222";
const secondObjectId = "33333333-3333-4333-8333-333333333333";
const firstStagingPath =
  `/objects/uploads/public-profile-staging/${companyId}/7/${firstObjectId}`;
const secondStagingPath =
  `/objects/uploads/public-profile-staging/${companyId}/7/${secondObjectId}`;

const profile = {
  companyId,
  unitId: 7,
  unitName: "Testna restavracija",
  slug: "testna-restavracija",
  active: true,
  description: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  primaryColor: "#1B3B36",
  logoUrl: null,
  coverImageUrl: null,
  maxPartySize: 8,
  slotMinutes: 30,
  slotCapacity: 20,
  openingHours: Array.from({ length: 7 }, (_, index) => ({
    dan: index + 1,
    odprto: false,
    intervals: [],
  })),
  dateExceptions: [],
  products: [],
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      enotaId: 7,
      enotaIme: "Testna restavracija",
      vloga: "admin",
    },
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: apiMocks.toast }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetJavniProfilNastavitveQueryKey: () => ["/api/javni-profil"],
  getListStripePreglediBonovQueryKey: () => ["/api/stripe-pregledi"],
  useGetJavniProfilNastavitve: () => ({ data: profile, isLoading: false }),
  useListStripePreglediBonov: () => ({ data: [] }),
  useResiStripePregledBona: () => ({ mutate: vi.fn(), isPending: false }),
  requestJavniProfilImageUpload: apiMocks.requestUpload,
  deleteJavniProfilImage: apiMocks.deleteImage,
  useUpdateJavniProfilNastavitve: (options: {
    mutation?: {
      onSuccess?: (result: unknown, variables: { data: unknown }) => void;
    };
  }) => ({
    mutate: (variables: { data: unknown }) => {
      apiMocks.update(variables);
      options.mutation?.onSuccess?.(profile, variables);
    },
    isPending: false,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JavnaStran />
    </QueryClientProvider>,
  );
}

function chooseLogo(file: File) {
  fireEvent.change(screen.getByTestId("input-logo"), {
    target: { files: [file] },
  });
}

describe("prenos logotipa javnega profila", () => {
  beforeEach(() => {
    apiMocks.requestUpload
      .mockResolvedValueOnce({
        objectPath: firstStagingPath,
        uploadURL: "https://storage.example.test/first",
      })
      .mockResolvedValueOnce({
        objectPath: secondStagingPath,
        uploadURL: "https://storage.example.test/second",
      });
    apiMocks.deleteImage.mockResolvedValue({ deleted: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn()
        .mockReturnValueOnce("blob:test-logo-first")
        .mockReturnValueOnce("blob:test-logo-second"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("preveri datoteko, jo prenese, prikaže, shrani, zamenja in odstrani", async () => {
    renderPage();
    fireEvent.mouseDown(screen.getByTestId("tab-izgled"), {
      button: 0,
      ctrlKey: false,
    });
    await screen.findByTestId("input-logo");

    chooseLogo(new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }));
    expect(apiMocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Izberite sliko JPG, PNG ali WEBP.",
      variant: "destructive",
    }));
    expect(apiMocks.requestUpload).not.toHaveBeenCalled();

    chooseLogo(new File(
      [new Uint8Array(5 * 1024 * 1024 + 1)],
      "prevelik.png",
      { type: "image/png" },
    ));
    expect(apiMocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Slika je lahko velika največ 5 MB.",
      variant: "destructive",
    }));
    expect(apiMocks.requestUpload).not.toHaveBeenCalled();

    const firstLogo = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
      "logo.png",
      { type: "image/png" },
    );
    chooseLogo(firstLogo);

    await waitFor(() => {
      expect(apiMocks.requestUpload).toHaveBeenCalledWith({
        name: "logo.png",
        size: firstLogo.size,
        contentType: "image/png",
      });
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://storage.example.test/first",
      {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: firstLogo,
      },
    );
    expect((await screen.findByAltText("Logotip – predogled")).getAttribute("src"))
      .toBe("blob:test-logo-first");

    fireEvent.click(screen.getByTestId("button-save"));
    await waitFor(() => {
      expect(apiMocks.update).toHaveBeenCalledWith({
        data: expect.objectContaining({ logoUrl: firstStagingPath }),
      });
    });
    expect(apiMocks.toast).toHaveBeenCalledWith({
      title: "Spremembe javnega profila so shranjene.",
    });

    const secondLogo = new File(
      [new Uint8Array([0xff, 0xd8, 0xff])],
      "nov-logo.jpg",
      { type: "image/jpeg" },
    );
    chooseLogo(secondLogo);

    await waitFor(() => {
      expect(apiMocks.deleteImage).toHaveBeenCalledWith(firstObjectId);
      expect(screen.getByAltText("Logotip – predogled").getAttribute("src"))
        .toBe("blob:test-logo-second");
    });
    expect(fetch).toHaveBeenLastCalledWith(
      "https://storage.example.test/second",
      {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: secondLogo,
      },
    );

    fireEvent.click(screen.getByTestId("input-logo-remove"));
    await waitFor(() => {
      expect(apiMocks.deleteImage).toHaveBeenCalledWith(secondObjectId);
      expect(screen.queryByAltText("Logotip – predogled")).toBeNull();
    });
  });
});