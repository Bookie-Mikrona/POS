import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  deleteJavniProfilImage: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  deleteJavniProfilImage: apiMocks.deleteJavniProfilImage,
}));

import { usePublicProfileStagingImages } from "./usePublicProfileStagingImages";

const stagingPath =
  "/objects/uploads/public-profile-staging/11111111-1111-4111-8111-111111111111/7/22222222-2222-4222-8222-222222222222";

type Tracker = ReturnType<typeof usePublicProfileStagingImages>;

function Harness({ ready }: { ready: (tracker: Tracker) => void }) {
  const tracker = usePublicProfileStagingImages();
  useEffect(() => ready(tracker), [ready, tracker]);
  return null;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("življenjski cikel začasnih slik javnega profila", () => {
  it("ob zaprtju urejevalnika odstrani naloženo, a neshranjeno sliko", async () => {
    apiMocks.deleteJavniProfilImage.mockResolvedValue({ deleted: true });
    let tracker!: Tracker;
    const ready = (value: Tracker) => { tracker = value; };
    const view = render(<Harness ready={ready} />);

    act(() => tracker.track(stagingPath));
    view.unmount();

    await waitFor(() => {
      expect(apiMocks.deleteJavniProfilImage)
        .toHaveBeenCalledWith(
          "22222222-2222-4222-8222-222222222222",
          { keepalive: true },
        );
    });
  });

  it("po uspešnem shranjevanju promovirane slike ob zaprtju ne briše", async () => {
    apiMocks.deleteJavniProfilImage.mockResolvedValue({ deleted: true });
    let tracker!: Tracker;
    const ready = (value: Tracker) => { tracker = value; };
    const view = render(<Harness ready={ready} />);

    act(() => {
      tracker.track(stagingPath);
      tracker.markSaved([stagingPath]);
    });
    view.unmount();
    await Promise.resolve();

    expect(apiMocks.deleteJavniProfilImage).not.toHaveBeenCalled();
  });

  it("pozno zaključen prenos po zaprtju takoj počisti", async () => {
    apiMocks.deleteJavniProfilImage.mockResolvedValue({ deleted: true });
    let tracker!: Tracker;
    const ready = (value: Tracker) => { tracker = value; };
    const view = render(<Harness ready={ready} />);
    view.unmount();

    act(() => tracker.track(stagingPath));

    await waitFor(() => {
      expect(apiMocks.deleteJavniProfilImage).toHaveBeenCalledOnce();
    });
  });
});