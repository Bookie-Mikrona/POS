import { HarmBlockThreshold, HarmCategory, Modality } from "@google/genai";
import { ai } from "../client";

export type GeneratedImage = {
  b64Json: string;
  mimeType: string;
};

export type ImageReference = {
  b64Json: string;
  mimeType: string;
};

export type ImageGenerationConfig = {
  aspectRatio?: string;
  imageSize?: string;
};

export class ImageGenerationError extends Error {
  constructor(
    public readonly reason: "blocked" | "missing_image",
    message: string,
  ) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

export async function generateImage(
  prompt: string,
  options: {
    abortSignal?: AbortSignal;
    referenceImages?: ImageReference[];
    imageConfig?: ImageGenerationConfig;
  } = {},
): Promise<GeneratedImage> {
  const parts = [
    { text: prompt },
    ...(options.referenceImages ?? []).map((reference) => ({
      inlineData: { data: reference.b64Json, mimeType: reference.mimeType },
    })),
  ];
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts }],
    config: {
      abortSignal: options.abortSignal,
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: options.imageConfig,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      ],
    },
  });

  if (response.promptFeedback?.blockReason) {
    throw new ImageGenerationError("blocked", "Opis slike je bil varnostno zavrnjen.");
  }
  const candidate = response.candidates?.[0];
  if (candidate?.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(String(candidate.finishReason))) {
    throw new ImageGenerationError("blocked", "Ustvarjanje slike je bilo varnostno ustavljeno.");
  }
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData,
  );
  if (!imagePart?.inlineData?.data) {
    throw new ImageGenerationError("missing_image", "Gemini ni vrnil slike.");
  }

  return {
    b64Json: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}