import canvasSketch from "canvas-sketch";
import { createSaveSetup } from "./export-png.js";
import { canvasToBuffer, downloadBuffer } from "../save.js";
import { deflate, inflate } from "pako";
import ColorEngine from "jscolorengine";
import {
  extractChunks,
  encodeChunks,
} from "../src/png-metadata-writer/index.js";
import { decode, encode } from "fast-png";
import { parse as parseICC } from "icc";
import {
  Intents,
  decodeProfileData,
  decode_iCCP,
  encode_iCCP,
  encode_iTXt,
  encode_pHYs_PPI,
  encode_sRGB,
  encode_standardChromatics,
  encode_standardGamma,
  withoutChunks,
} from "../src/util.js";
import { Buffer } from "buffer";
import paperSizes from "../src/paper-sizes.js";
import convert from "convert-length";

export default function pngForPrint(pngBuffer, opts = {}) {
  const { pixelsPerInch, colorSpace, intent = Intents.Perceptual } = opts;
  const { width, height, data, depth } = decode(pngBuffer);
  if (depth !== 8) throw new Error("Currently only 8-bit depth is supported");
  let chunks = extractChunks(pngBuffer);

  // If pixelsPerInch is unspecified, do not modify pHYs
  // If pixelsPerInch is specified, replace existing chunk
  if (pixelsPerInch) {
    chunks = withoutChunks(chunks, "pHYs");
    const pHYs = encode_pHYs_PPI(pixelsPerInch);
    chunks.splice(1, 0, { name: "pHYs", data: pHYs });
  }

  // User has specified the output as 'srgb'
  if (colorSpace === "srgb") {
    // Strip existing color chunks
    chunks = withoutChunks(chunks, ["gAMA", "cHRM", "sRGB", "iCCP"]);
    // Replace with new standardized sRGB chunks
    chunks.splice(
      1,
      0,
      { name: "sRGB", data: encode_sRGB(intent) },
      { name: "gAMA", data: encode_standardGamma() },
      { name: "cHRM", data: encode_standardChromatics() }
    );
  } else if (colorSpace === "display-p3") {
    // Nothing to do
  }

  return encodeChunks(chunks);
}
