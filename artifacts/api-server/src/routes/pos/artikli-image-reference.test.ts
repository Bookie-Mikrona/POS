import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import express from "express";
import supertest from "supertest";

const {
  generateImageMock,
  loadReferencesMock,
  savePublicObjectMock,
  ReferenceErrorMock,
} = vi.hoisted(() => {
  class ReferenceErrorMock extends Error {}
  return {
    generateImageMock: vi.fn(),
    loadReferencesMock: vi.fn(),
    savePublicObjectMock: vi.fn(),
    ReferenceErrorMock,
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const article = { id: 7, prodajniArtikel: true };
  const chain = {
    from: () => chain,
    where: () => chain,
    leftJoin: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve([article]),
    then: (resolve: (value: typeof article[]) => unknown) => resolve([article]),
  };
  const update = () => ({ set: () => ({ where: () => Promise.resolve([]) }) });
  const insert = () => ({ values: () => Promise.resolve([]) });
  return {
    ...original,
    db: {
      select: () => chain,
      update,
      insert,
      transaction: async (callback: (tx: { update: typeof update; insert: typeof insert }) => unknown) =>
        callback({ update, insert }),
    },
  };
});

vi.mock("@workspace/integrations-gemini-ai/image", () => ({
  generateImage: generateImageMock,
  ImageGenerationError: class ImageGenerationError extends Error {},
}));

vi.mock("../../middlewares/pos", () => ({
  requireEnota: (req: { enotaId?: number }, _res: unknown, next: () => void) => {
    req.enotaId = 1;
    next();
  },
}));

vi.mock("../../lib/article-image-references", () => ({
  ArticleImageReferenceError: ReferenceErrorMock,
  extractArticleImageReferenceUrls: vi.fn(() => ["https://127.0.0.1/logo.png"]),
  loadArticleImageReferences: loadReferencesMock,
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class ObjectStorageService {
    savePublicObject = savePublicObjectMock;
  },
}));

import artikliRouter from "./artikli";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => {
    (req as { enotaId?: number }).enotaId = 1;
    (req as any).log = { error: () => {} };
    next();
  });
  instance.use(artikliRouter);
  return instance;
}

describe("generiranje slike artikla z referencami", () => {
  beforeEach(() => {
    generateImageMock.mockReset();
    savePublicObjectMock.mockReset();
    loadReferencesMock.mockReset();
    loadReferencesMock.mockRejectedValue(
      new ReferenceErrorMock("Referenčna povezava kaže na nedovoljen ali notranji strežnik."),
    );
  });

  it("pri zavrnjeni referenci ne kliče Gemini in ne shranjuje slike", async () => {
    const response = await supertest(app())
      .post("/artikli/7/generiraj-sliko")
      .send({ opisSlike: "Espresso https://127.0.0.1/logo.png" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("nedovoljen ali notranji");
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(savePublicObjectMock).not.toHaveBeenCalled();
  });
});

describe("ročni upload slike artikla", () => {
  beforeEach(() => {
    savePublicObjectMock.mockReset();
    savePublicObjectMock.mockResolvedValue(undefined);
  });

  it("shrani veljavno PNG sliko in vrne posodobljen artikel", async () => {
    const source = createCanvas(400, 1000);
    source.getContext("2d").fillRect(0, 0, 400, 1000);
    const png = source.toBuffer("image/png");
    const response = await supertest(app())
      .post("/artikli/7/nalozi-sliko")
      .attach("file", png, { filename: "moja-slika.png", contentType: "image/png" });

    expect(response.status).toBe(200);
    expect(savePublicObjectMock).toHaveBeenCalledWith(
      expect.stringMatching(/^article-images\/enota-1\/artikel-7-.+\.webp$/),
      expect.any(Buffer),
      "image/webp",
    );
    const storedImage = await loadImage(savePublicObjectMock.mock.calls[0][1] as Buffer);
    expect([storedImage.width, storedImage.height]).toEqual([1500, 600]);
  });

  it("zavrne manjkajočo datoteko in MIME-spoofing", async () => {
    const brezDatoteke = await supertest(app())
      .post("/artikli/7/nalozi-sliko");
    expect(brezDatoteke.status).toBe(400);
    expect(brezDatoteke.body.error).toContain("Izberite sliko");

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const napačenTip = await supertest(app())
      .post("/artikli/7/nalozi-sliko")
      .attach("file", png, { filename: "slika.jpg", contentType: "image/jpeg" });
    expect(napačenTip.status).toBe(400);
    expect(napačenTip.body.error).toContain("JPEG, PNG ali WebP");
    expect(savePublicObjectMock).not.toHaveBeenCalled();
  });

  it("zavrne preveliko datoteko", async () => {
    const prevelika = await supertest(app())
      .post("/artikli/7/nalozi-sliko")
      .attach("file", Buffer.alloc(8 * 1024 * 1024 + 1), {
        filename: "prevelika.png",
        contentType: "image/png",
      });

    expect(prevelika.status).toBe(400);
    expect(prevelika.body.error).toContain("8 MB");
    expect(savePublicObjectMock).not.toHaveBeenCalled();
  });

  it("zavrne preveliko ločljivost še pred dekodiranjem slike", async () => {
    const pngHeader = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(pngHeader);
    pngHeader.write("IHDR", 12, "ascii");
    pngHeader.writeUInt32BE(5000, 16);
    pngHeader.writeUInt32BE(5000, 20);

    const response = await supertest(app())
      .post("/artikli/7/nalozi-sliko")
      .attach("file", pngHeader, { filename: "prevelika-locljivost.png", contentType: "image/png" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("prevelike dimenzije");
    expect(savePublicObjectMock).not.toHaveBeenCalled();
  });

  it("zavrne pokvarjeno sliko z veljavno glavo", async () => {
    const pngHeader = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(pngHeader);
    pngHeader.write("IHDR", 12, "ascii");
    pngHeader.writeUInt32BE(1000, 16);
    pngHeader.writeUInt32BE(1000, 20);

    const response = await supertest(app())
      .post("/artikli/7/nalozi-sliko")
      .attach("file", pngHeader, { filename: "pokvarjena.png", contentType: "image/png" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("ni mogoče prebrati");
    expect(savePublicObjectMock).not.toHaveBeenCalled();
  });
});