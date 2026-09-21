import type * as NapiCanvas from "@napi-rs/canvas";
import { requireRuntimePackage } from "./runtime-require";

const napiCanvas = requireRuntimePackage("@napi-rs/canvas") as typeof NapiCanvas;

export const createCanvas = napiCanvas.createCanvas;
export const loadImage = napiCanvas.loadImage;
export const GlobalFonts = napiCanvas.GlobalFonts;