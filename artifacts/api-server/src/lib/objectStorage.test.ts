import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => {
  const getFiles = vi.fn();
  const exists = vi.fn();
  const deleteFile = vi.fn();
  const save = vi.fn();
  const file = vi.fn((_name: string) => ({
    exists,
    delete: deleteFile,
    save,
  }));
  const bucket = vi.fn((_name: string) => ({ getFiles, file }));
  return { bucket, deleteFile, exists, file, getFiles, save };
});

vi.mock("@google-cloud/storage", () => ({
  File: class {},
  Storage: class {
    bucket(name: string) {
      return storageMocks.bucket(name);
    }
  },
}));

import {
  evaluateObjectStorageReadiness,
  ObjectStorageService,
} from "./objectStorage";

const stagingPrefix = "uploads/public-profile-staging";
const privateRoot = "private-root";

function listedFile(
  name: string,
  timeCreated?: string,
): { name: string; metadata: { timeCreated?: string } } {
  return {
    name: `${privateRoot}/${name}`,
    metadata: timeCreated === undefined ? {} : { timeCreated },
  };
}

beforeEach(() => {
  vi.stubEnv("PRIVATE_OBJECT_DIR", `/controlled-bucket/${privateRoot}`);
  storageMocks.bucket.mockClear();
  storageMocks.getFiles.mockReset();
  storageMocks.file.mockClear();
  storageMocks.exists.mockReset();
  storageMocks.deleteFile.mockReset();
  storageMocks.save.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("App Storage readiness brez GCS zahteve", () => {
  it("sprejme veljavno zasebno konfiguracijo", () => {
    expect(
      evaluateObjectStorageReadiness({
        DEFAULT_OBJECT_STORAGE_BUCKET_ID: "controlled-bucket",
        PRIVATE_OBJECT_DIR: "/controlled-bucket/private-root/",
      }),
    ).toEqual({
      enabled: true,
      privateObjectDir: "/controlled-bucket/private-root",
    });
    expect(storageMocks.bucket).not.toHaveBeenCalled();
  });

  it("brez omogočenih App Storage funkcij vrne izključeno stanje", () => {
    expect(evaluateObjectStorageReadiness({})).toEqual({
      enabled: false,
      reason: "app_storage_not_configured",
    });
    expect(storageMocks.bucket).not.toHaveBeenCalled();
  });

  it("ob delni konfiguraciji jasno zahteva PRIVATE_OBJECT_DIR", () => {
    expect(() =>
      evaluateObjectStorageReadiness({
        PUBLIC_OBJECT_SEARCH_PATHS: "/controlled-bucket/public",
      }),
    ).toThrow("PRIVATE_OBJECT_DIR not set");
    expect(storageMocks.bucket).not.toHaveBeenCalled();
  });

  it("nevaren PRIVATE_OBJECT_DIR zavrne pred GCS zahtevo", () => {
    expect(() =>
      evaluateObjectStorageReadiness({
        DEFAULT_OBJECT_STORAGE_BUCKET_ID: "controlled-bucket",
        PRIVATE_OBJECT_DIR: "/controlled-bucket/../private-root",
      }),
    ).toThrow("Invalid PRIVATE_OBJECT_DIR");
    expect(storageMocks.bucket).not.toHaveBeenCalled();
  });

  it("nevaren PUBLIC_OBJECT_SEARCH_PATHS zavrne pred GCS zahtevo", () => {
    expect(() =>
      evaluateObjectStorageReadiness({
        PRIVATE_OBJECT_DIR: "/controlled-bucket/private-root",
        PUBLIC_OBJECT_SEARCH_PATHS: "/controlled-bucket/public/../private",
      }),
    ).toThrow("Invalid PUBLIC_OBJECT_SEARCH_PATHS");
    expect(storageMocks.bucket).not.toHaveBeenCalled();
  });
});

describe("validacija javnih App Storage korenov", () => {
  it.each([
    "/ab/public",
    "/CONTROLLED-BUCKET/public",
    "/controlled..bucket/public",
    "/192.168.0.1/public",
  ])("zavrne pokvarjen bucket %s pred GCS klicem", async (publicPath) => {
    vi.stubEnv("PUBLIC_OBJECT_SEARCH_PATHS", publicPath);
    const service = new ObjectStorageService();

    await expect(service.searchPublicObject("image.png"))
      .rejects.toThrow("Invalid PUBLIC_OBJECT_SEARCH_PATHS");
    await expect(service.savePublicObject("image.png", Buffer.from("x"), "image/png"))
      .rejects.toThrow("Invalid PUBLIC_OBJECT_SEARCH_PATHS");
    expect(storageMocks.bucket).not.toHaveBeenCalled();
    expect(storageMocks.file).not.toHaveBeenCalled();
  });

  it.each([
    "/controlled-bucket",
    "/controlled-bucket/public/../private",
    "/controlled-bucket/public//nested",
    "/controlled-bucket/public path",
    "controlled-bucket/public",
  ])("zavrne pokvarjen javni segment %s pred GCS klicem", async (publicPath) => {
    vi.stubEnv("PUBLIC_OBJECT_SEARCH_PATHS", publicPath);
    const service = new ObjectStorageService();

    await expect(service.searchPublicObject("image.png"))
      .rejects.toThrow("Invalid PUBLIC_OBJECT_SEARCH_PATHS");
    expect(storageMocks.bucket).not.toHaveBeenCalled();
    expect(storageMocks.file).not.toHaveBeenCalled();
  });

  it("ohrani več veljavnih korenov in odstrani podvojene vnose", () => {
    vi.stubEnv(
      "PUBLIC_OBJECT_SEARCH_PATHS",
      " /controlled-bucket/public/, /second-bucket/assets/nested, /controlled-bucket/public ",
    );

    expect(new ObjectStorageService().getPublicObjectSearchPaths()).toEqual([
      "/controlled-bucket/public",
      "/second-bucket/assets/nested",
    ]);
    expect(storageMocks.bucket).not.toHaveBeenCalled();
    expect(storageMocks.file).not.toHaveBeenCalled();
  });
});

describe("skupna validacija relativnih javnih poti", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_OBJECT_SEARCH_PATHS", "/controlled-bucket/public");
  });

  it.each([
    "", "/", "/image.png", "//image.png", "images/", "images//image.png",
    ".", "..", "./image.png", "../image.png", "images/./image.png",
    "images/../image.png", "images/.", "images/..",
    "images\\image.png", "images/..\\image.png",
    "%2e%2e/image.png", "images/%2E/image.png", "images%2fimage.png",
    "images%2Fimage.png", "images/%5cimage.png", "images/%5Cimage.png",
    "images/%252e%252e/image.png", "images/%255cimage.png",
    "images/%00.png", "images/100%.png", "images/%zz.png",
    "images/image.png?size=1", "images/image.png#fragment",
    "images/\0image.png", "images/\nimage.png", "images/\u007fimage.png",
  ])("branje in zapis zavrneta %j brez GCS klicev", async (path) => {
    const service = new ObjectStorageService();

    await expect(service.searchPublicObject(path))
      .rejects.toThrow("Invalid public object path");
    await expect(service.savePublicObject(path, Buffer.from("x"), "image/png"))
      .rejects.toThrow("Invalid public object path");

    expect(storageMocks.bucket).not.toHaveBeenCalled();
    expect(storageMocks.file).not.toHaveBeenCalled();
    expect(storageMocks.exists).not.toHaveBeenCalled();
    expect(storageMocks.save).not.toHaveBeenCalled();
  });

  it.each([
    "image.png",
    "images/company-1/menu/photo.v2.png",
    "slike/poletni meni/Čokoladni štrukelj 日本語.png",
    ".images/ime..datoteke.png",
    "slike/ ime s presledki .png",
  ])("branje in zapis ohranita isto veljavno pot %j", async (path) => {
    storageMocks.exists.mockResolvedValue([true]);
    storageMocks.save.mockResolvedValue(undefined);
    const service = new ObjectStorageService();
    const contents = Buffer.from("image contents");

    await service.savePublicObject(path, contents, "image/png");
    const file = await service.searchPublicObject(path);

    expect(file).not.toBeNull();
    expect(storageMocks.bucket.mock.calls).toEqual([
      ["controlled-bucket"], ["controlled-bucket"],
    ]);
    expect(storageMocks.file.mock.calls).toEqual([
      [`public/${path}`], [`public/${path}`],
    ]);
    expect(storageMocks.save).toHaveBeenCalledExactlyOnceWith(contents, {
      resumable: false,
      metadata: {
        contentType: "image/png",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    expect(storageMocks.exists).toHaveBeenCalledOnce();
  });

  it("zapis uporabi prvi koren, branje pa preišče vse korene", async () => {
    vi.stubEnv(
      "PUBLIC_OBJECT_SEARCH_PATHS",
      "/controlled-bucket/public/, /second-bucket/assets",
    );
    storageMocks.exists.mockResolvedValueOnce([false]).mockResolvedValueOnce([true]);
    const service = new ObjectStorageService();

    await service.savePublicObject("nested/image.png", Buffer.from("x"), "image/png");
    expect(await service.searchPublicObject("nested/image.png")).not.toBeNull();

    expect(storageMocks.bucket.mock.calls).toEqual([
      ["controlled-bucket"], ["controlled-bucket"], ["second-bucket"],
    ]);
    expect(storageMocks.file.mock.calls).toEqual([
      ["public/nested/image.png"], ["public/nested/image.png"], ["assets/nested/image.png"],
    ]);
    expect(storageMocks.save).toHaveBeenCalledOnce();
  });
});

describe("stranitev seznama App Storage objektov", () => {
  it("uporabi točen staging prefix in pretvori GCS metapodatke v objektne poti", async () => {
    storageMocks.getFiles.mockResolvedValue([
      [
        listedFile(
          `${stagingPrefix}/company-1/7/valid`,
          "2026-08-01T10:20:30.000Z",
        ),
        listedFile(`${stagingPrefix}/company-1/7/missing`),
        listedFile(
          `${stagingPrefix}/company-1/7/invalid`,
          "ni-datum",
        ),
      ],
      { pageToken: "next-controlled-page" },
      {},
    ]);
    const service = new ObjectStorageService();

    const result = await service.listObjectEntityPage(stagingPrefix, {
      pageSize: 100,
      pageToken: "current-controlled-page",
    });

    expect(storageMocks.bucket).toHaveBeenCalledOnce();
    expect(storageMocks.bucket).toHaveBeenCalledWith("controlled-bucket");
    expect(storageMocks.getFiles).toHaveBeenCalledOnce();
    expect(storageMocks.getFiles).toHaveBeenCalledWith({
      autoPaginate: false,
      maxResults: 100,
      pageToken: "current-controlled-page",
      prefix: `${privateRoot}/${stagingPrefix}/`,
    });
    expect(result).toEqual({
      objects: [
        {
          objectPath: `/objects/${stagingPrefix}/company-1/7/valid`,
          timeCreated: new Date("2026-08-01T10:20:30.000Z"),
        },
        {
          objectPath: `/objects/${stagingPrefix}/company-1/7/missing`,
          timeCreated: null,
        },
        {
          objectPath: `/objects/${stagingPrefix}/company-1/7/invalid`,
          timeCreated: null,
        },
      ],
      nextPageToken: "next-controlled-page",
    });
  });

  it.each([
    "uploads/../documents",
    "uploads/public profile",
  ])("zavrne neveljaven prefix %s pred klicem GCS", async (prefix) => {
    const service = new ObjectStorageService();

    await expect(service.listObjectEntityPage(prefix, { pageSize: 100 }))
      .rejects.toThrow("Invalid object listing prefix");
    expect(storageMocks.bucket).not.toHaveBeenCalled();
    expect(storageMocks.getFiles).not.toHaveBeenCalled();
  });

  it.each([
    "/controlled-bucket",
    "/controlled-bucket/",
    "/controlled-bucket/../private-root",
    "/controlled-bucket/private root",
    "/CONTROLLED-BUCKET/private-root",
    "//private-root",
    "controlled-bucket/private-root",
  ])(
    "zavrne neveljaven PRIVATE_OBJECT_DIR %s pred vsakim GCS klicem",
    async (privateObjectDir) => {
      vi.stubEnv("PRIVATE_OBJECT_DIR", privateObjectDir);
      const service = new ObjectStorageService();
      const objectPath =
        `/objects/${stagingPrefix}/company-1/7/object-id`;

      await expect(
        service.listObjectEntityPage(stagingPrefix, { pageSize: 100 }),
      ).rejects.toThrow("Invalid PRIVATE_OBJECT_DIR");
      await expect(service.deleteObjectEntity(objectPath))
        .rejects.toThrow("Invalid PRIVATE_OBJECT_DIR");
      expect(storageMocks.bucket).not.toHaveBeenCalled();
      expect(storageMocks.file).not.toHaveBeenCalled();
      expect(storageMocks.getFiles).not.toHaveBeenCalled();
      expect(storageMocks.deleteFile).not.toHaveBeenCalled();
    },
  );

  it("z veljavnim zasebnim korenom poišče in izbriše samo zahtevani objekt", async () => {
    storageMocks.exists.mockResolvedValue([true]);
    storageMocks.deleteFile.mockResolvedValue(undefined);
    const service = new ObjectStorageService();
    const relativePath =
      `${stagingPrefix}/company-1/7/object-id`;

    await service.deleteObjectEntity(`/objects/${relativePath}`);

    expect(storageMocks.bucket).toHaveBeenCalledOnce();
    expect(storageMocks.bucket).toHaveBeenCalledWith("controlled-bucket");
    expect(storageMocks.file).toHaveBeenCalledOnce();
    expect(storageMocks.file).toHaveBeenCalledWith(
      `${privateRoot}/${relativePath}`,
    );
    expect(storageMocks.exists).toHaveBeenCalledOnce();
    expect(storageMocks.deleteFile).toHaveBeenCalledOnce();
    expect(storageMocks.deleteFile).toHaveBeenCalledWith({
      ignoreNotFound: true,
    });
  });

  it("ohrani veljaven skriti in ugnezden zasebni koren", () => {
    vi.stubEnv(
      "PRIVATE_OBJECT_DIR",
      "/controlled-bucket/.private/nested_root/",
    );

    expect(new ObjectStorageService().getPrivateObjectDir()).toBe(
      "/controlled-bucket/.private/nested_root",
    );
    expect(storageMocks.bucket).not.toHaveBeenCalled();
  });
});