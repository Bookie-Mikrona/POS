import { describe, expect, it, vi } from "vitest";
import { getListAktivnaNarocilaQueryKey, getListMizeQueryKey } from "@workspace/api-client-react";
import { osveziPregledMizPoTelefonu } from "./osveziPregledMiz";

describe("osveziPregledMizPoTelefonu", () => {
  it("počaka na osvežitev naročil in miz, preden lahko sledi navigacija", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await osveziPregledMizPoTelefonu({ invalidateQueries } as never);

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getListAktivnaNarocilaQueryKey(),
      refetchType: "active",
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getListMizeQueryKey(),
      refetchType: "active",
    });
  });
});