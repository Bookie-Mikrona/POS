import { afterEach, describe, expect, it, vi } from "vitest";
import { ai } from "@workspace/integrations-gemini-ai";
import { generateImage } from "@workspace/integrations-gemini-ai/image";

describe("Gemini slikovne reference", () => {
  const generateContentSpy = vi.spyOn(ai.models, "generateContent");

  afterEach(() => {
    generateContentSpy.mockReset();
  });

  it("pošlje besedilni opis in preverjene reference kot Gemini inline slike", async () => {
    generateContentSpy.mockResolvedValue({
      candidates: [{
        content: {
          parts: [{ inlineData: { data: "generated-image", mimeType: "image/png" } }],
        },
      }],
    } as never);

    await expect(generateImage("Naredi fotografijo espressa", {
      referenceImages: [
        { mimeType: "image/jpeg", b64Json: "reference-one" },
        { mimeType: "image/webp", b64Json: "reference-two" },
      ],
    })).resolves.toEqual({ b64Json: "generated-image", mimeType: "image/png" });

    expect(generateContentSpy).toHaveBeenCalledWith(expect.objectContaining({
      contents: [{
        role: "user",
        parts: [
          { text: "Naredi fotografijo espressa" },
          { inlineData: { mimeType: "image/jpeg", data: "reference-one" } },
          { inlineData: { mimeType: "image/webp", data: "reference-two" } },
        ],
      }],
    }));
  });

  it("posreduje zahtevo za izvorno slikovno razmerje in ločljivost", async () => {
    generateContentSpy.mockResolvedValue({
      candidates: [{
        content: {
          parts: [{ inlineData: { data: "generated-image", mimeType: "image/png" } }],
        },
      }],
    } as never);

    await generateImage("Naredi panoramsko fotografijo pice", {
      imageConfig: { aspectRatio: "21:9", imageSize: "2K" },
    });

    expect(generateContentSpy).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        imageConfig: { aspectRatio: "21:9", imageSize: "2K" },
      }),
    }));
  });
});