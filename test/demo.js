// to test:
// https://www.shadertoy.com/view/WlcBRn
// https://www.jakelow.com/blog/hobby-curves

import canvasSketch from "canvas-sketch";
import { createSaveSetup } from "./export-png.js";
import { canvasToBuffer, downloadBuffer } from "../save.js";
import { deflate, inflate } from "pako";
import ColorEngine from "jscolorengine";
import getDocument from "canvas-dimensions";
import {
  extractChunks,
  encodeChunks,
} from "../src/png-metadata-writer/index.js";
import { decode, encode } from "fast-png";
import { parse as parseICC } from "icc";
import {
  decodeProfileData,
  decode_iCCP,
  encode_iCCP,
  encode_iTXt,
  encode_pHYs_PPI,
  withoutChunks,
} from "../src/util.js";
import { Buffer } from "buffer";
import paperSizes from "../src/paper-sizes.js";
import convert from "convert-length";
import pngForPrint from "./png-for-print.js";

const render = ({ context, width, height }) => {
  const grad = context.createLinearGradient(width * 0.1, 0, width * 0.9, 0);
  grad.addColorStop(0, "color(display-p3 0 1 0)");
  grad.addColorStop(1, "color(display-p3 1 0 0)");

  context.fillStyle = grad;
  // context.fillStyle = "color(display-p3 0 1 0)";
  context.fillRect(0, 0, width, height);
};

async function setup() {
  const { width, height, canvasWidth, canvasHeight } = getDocument({
    dimensions: "a4",
    units: "cm",
    pixelsPerInch: 300,
  });

  canvas.width = doc.canvasWidth;
  canvas.height = doc.canvasHeight;

  context.scale(canvasWidth / width, canvasHeight / height);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    colorSpace: "display-p3",
  });
  document.body.appendChild(canvas);

  canvas.width = canvasWidth;
  canvas.height = canvasWidth;
  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${canvasHeight}px`;
  render({ context, width, height });

  // const data = context.getImageData(0, 0, width, height);
  // console.log("raw data", data.data);

  const png = await canvasToBuffer(canvas, {});
  // const newPng = pngForPrint(png, {
  //   pixelsPerInch: 300,
  // });

  const newPng = png;
  console.log("Data:", newPng);

  createSaveSetup(async () => {
    const filename = `canvas-${Date.now()}.png`;
    downloadBuffer(newPng, { filename });
    // exporter.write(png);
  });
}

setup();
