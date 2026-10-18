import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectStorageService, objectStorageClient } from "./objectStorage";

afterEach(() => vi.restoreAllMocks());

describe("deterministic private object writes", () => {
  it("uses the same private key for retries, with private caching and XML metadata", async () => {
    const service = new ObjectStorageService();
    vi.spyOn(service, "getPrivateObjectDir").mockReturnValue("/test-bucket/private/");
    const save = vi.fn().mockResolvedValue(undefined);
    const file = vi.fn().mockReturnValue({ save });
    vi.spyOn(objectStorageClient, "bucket").mockReturnValue({ file } as never);
    for (let n = 0; n < 2; n++) {
      expect(await service.savePrivateObject("vat-xml/company/2026-0709/submission.xml",
        Buffer.from("<xml/>"), "application/xml"))
        .toBe("/objects/vat-xml/company/2026-0709/submission.xml");
    }
    expect(file.mock.calls).toEqual([
      ["private/vat-xml/company/2026-0709/submission.xml"],
      ["private/vat-xml/company/2026-0709/submission.xml"],
    ]);
    expect(save).toHaveBeenCalledWith(Buffer.from("<xml/>"), {
      resumable: false, timeout: 15_000,
      metadata: { contentType: "application/xml", cacheControl: "private, no-store" },
    });
  });

  it.each(["", "/escape", "../escape", "a/../escape", "a//b", "a/%2e%2e/b", "a\\b", "a/./b"])(
    "rejects unsafe destination %j before storage access", async (path) => {
      const service = new ObjectStorageService();
      const root = vi.spyOn(service, "getPrivateObjectDir");
      await expect(service.savePrivateObject(path, Buffer.from("xml"), "application/xml"))
        .rejects.toThrow("Invalid private object destination path");
      expect(root).not.toHaveBeenCalled();
    },
  );
});
