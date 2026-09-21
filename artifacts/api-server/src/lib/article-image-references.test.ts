import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());
const httpsRequestMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("node:https", () => ({ request: httpsRequestMock }));

import {
  ArticleImageReferenceError,
  extractArticleImageReferenceUrls,
  extractArticleImageUrlsFromHtml,
  loadArticleImageReferences,
} from "./article-image-references";

function validPng(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

function validWebp(): Buffer {
  return Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.from("data")]);
}

function respondWith(statusCode: number, headers: Record<string, string>, body: Uint8Array = Buffer.alloc(0)): void {
  httpsRequestMock.mockImplementation((_options: unknown, callback: (response: unknown) => void) => {
    const response = Object.assign(Readable.from([body]), { statusCode, headers });
    const request = {
      setTimeout: vi.fn(),
      on: vi.fn(),
      end: () => callback(response),
      destroy: vi.fn(),
    };
    return request;
  });
}

describe("reference images for article generation", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    httpsRequestMock.mockReset();
  });

  it("iz opisa prepozna do tri enolične povezave", () => {
    expect(extractArticleImageReferenceUrls(
      "Pica kot na https://example.com/pica, dodatno https://cdn.example.com/pica.jpg. Ponovi https://example.com/pica",
    )).toEqual(["https://example.com/pica", "https://cdn.example.com/pica.jpg"]);

    expect(() => extractArticleImageReferenceUrls(
      "https://one.example/a https://two.example/b https://three.example/c https://four.example/d",
    )).toThrow(ArticleImageReferenceError);
  });

  it("iz referenčne strani izbere og:image, twitter:image in relativne slike", () => {
    const html = `
      <meta content="/images/hero.webp" property="og:image">
      <meta name="twitter:image" content="https://cdn.example.com/tweet.jpg">
      <img data-src="/images/fallback.png">
    `;
    expect(extractArticleImageUrlsFromHtml(html, "https://example.com/products/pica")).toEqual([
      "https://example.com/images/hero.webp",
      "https://cdn.example.com/tweet.jpg",
      "https://example.com/images/fallback.png",
    ]);
  });

  it("prebere neposredno HTTPS sliko in jo kodira za Gemini", async () => {
    const image = validWebp();
    respondWith(200, { "content-type": "image/webp", "content-length": String(image.length) }, image);

    await expect(loadArticleImageReferences(["https://example.com/logo.webp"])).resolves.toEqual([
      {
        sourceUrl: "https://example.com/logo.webp",
        mimeType: "image/webp",
        b64Json: image.toString("base64"),
      },
    ]);
    expect(httpsRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      hostname: "93.184.216.34",
      servername: "example.com",
      headers: expect.objectContaining({ Host: "example.com" }),
    }), expect.any(Function));
  });

  it("prebere og:image s HTML strani", async () => {
    const image = validPng();
    httpsRequestMock
      .mockImplementationOnce((_options: unknown, callback: (response: unknown) => void) => {
        const response = Object.assign(
          Readable.from(['<meta property="og:image" content="https://cdn.example.com/referenca.png">']),
          { statusCode: 200, headers: { "content-type": "text/html" } },
        );
        return { setTimeout: vi.fn(), on: vi.fn(), end: () => callback(response), destroy: vi.fn() };
      })
      .mockImplementationOnce((_options: unknown, callback: (response: unknown) => void) => {
        const response = Object.assign(Readable.from([image]), { statusCode: 200, headers: { "content-type": "image/png" } });
        return { setTimeout: vi.fn(), on: vi.fn(), end: () => callback(response), destroy: vi.fn() };
      });

    const [reference] = await loadArticleImageReferences(["https://example.com/artikel"]);
    expect(reference).toMatchObject({
      sourceUrl: "https://cdn.example.com/referenca.png",
      mimeType: "image/png",
      b64Json: image.toString("base64"),
    });
  });

  it("na vsaki preusmeritvi uporabi na novo preverjen in pripet IP", async () => {
    const image = validPng();
    const redirectDestroyMock = vi.fn();
    lookupMock
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "93.184.216.35", family: 4 }]);
    httpsRequestMock
      .mockImplementationOnce((_options: unknown, callback: (response: unknown) => void) => {
        const response = Object.assign(Readable.from([]), {
          statusCode: 302,
          headers: { location: "https://cdn.example.com/reference.png" },
        });
        const originalDestroy = response.destroy.bind(response);
        response.destroy = ((error?: Error) => {
          redirectDestroyMock();
          return originalDestroy(error);
        }) as typeof response.destroy;
        return { setTimeout: vi.fn(), on: vi.fn(), end: () => callback(response), destroy: vi.fn() };
      })
      .mockImplementationOnce((_options: unknown, callback: (response: unknown) => void) => {
        const response = Object.assign(Readable.from([image]), { statusCode: 200, headers: { "content-type": "image/png" } });
        return { setTimeout: vi.fn(), on: vi.fn(), end: () => callback(response), destroy: vi.fn() };
      });

    await expect(loadArticleImageReferences(["https://example.com/start"])).resolves.toHaveLength(1);
    expect(redirectDestroyMock).toHaveBeenCalledOnce();
    expect(httpsRequestMock.mock.calls[0]![0]).toEqual(expect.objectContaining({ hostname: "93.184.216.34", servername: "example.com" }));
    expect(httpsRequestMock.mock.calls[1]![0]).toEqual(expect.objectContaining({ hostname: "93.184.216.35", servername: "cdn.example.com" }));
  });

  it("prekine neskončno počasen odgovor po absolutni časovni omejitvi", async () => {
    vi.useFakeTimers();
    try {
      const slowResponse = Object.assign(new Readable({ read() {} }), {
        statusCode: 200,
        headers: { "content-type": "image/png" },
      });
      const destroyMock = vi.spyOn(slowResponse, "destroy");
      httpsRequestMock.mockImplementation((_options: unknown, callback: (response: unknown) => void) => (
        { setTimeout: vi.fn(), on: vi.fn(), end: () => callback(slowResponse), destroy: vi.fn() }
      ));

      const loading = loadArticleImageReferences(["https://example.com/slow.png"]);
      const rejection = expect(loading).rejects.toThrow("pravočasno prebrati");
      await vi.advanceTimersByTimeAsync(8_001);
      await rejection;
      expect(destroyMock).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("zavrne MIME-spoofing in ne podaja poljubnih bajtov Gemini", async () => {
    respondWith(200, { "content-type": "image/jpeg" }, Buffer.from("this is not a jpeg"));
    await expect(loadArticleImageReferences(["https://example.com/spoof.jpg"]))
      .rejects.toThrow("nima veljavne");
  });

  it("pred klicem HTTPS zavrne HTTP ter lokalne in zasebne naslove", async () => {
    await expect(loadArticleImageReferences(["http://example.com/slika.jpg"]))
      .rejects.toThrow("HTTPS");
    await expect(loadArticleImageReferences(["https://127.0.0.1/slika.jpg"]))
      .rejects.toThrow("nedovoljen ali notranji");
    await expect(loadArticleImageReferences(["https://[::1]/slika.jpg"]))
      .rejects.toThrow("nedovoljen ali notranji");
    await expect(loadArticleImageReferences(["https://[::ffff:127.0.0.1]/slika.jpg"]))
      .rejects.toThrow("nedovoljen ali notranji");
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });
});