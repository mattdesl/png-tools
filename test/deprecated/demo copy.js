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
  decodeProfileData,
  decode_iCCP,
  encode_iCCP,
  encode_iTXt,
  encode_pHYs_PPI,
  withoutChunks,
} from "../../src/util.js";
import { Buffer } from "buffer";
import paperSizes from "../src/paper-sizes.js";
import convert from "convert-length";

const render = ({ context, width, height }) => {
  const grad = context.createLinearGradient(width * 0.1, 0, width * 0.9, 0);
  grad.addColorStop(0, "color(display-p3 0 1 0)");
  grad.addColorStop(1, "color(display-p3 1 0 0)");

  context.fillStyle = grad;
  // context.fillStyle = "color(display-p3 0 1 0)";
  context.fillRect(0, 0, width, height);
};

async function setup() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    colorSpace: "display-p3",
  });
  document.body.appendChild(canvas);

  // A6 standard paper size
  // const { width, height } = paperSizes.
  const width = 256;
  const height = 256;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `256px`;
  canvas.style.height = `256px`;
  render({ context, width, height });

  const data = context.getImageData(0, 0, width, height);
  console.log("raw data", data.data);

  const png = await canvasToBuffer(canvas, {});

  let chunks = extractChunks(png);

  const IHDR = chunks.find((c) => c.name === "IHDR");
  {
    const dv = new DataView(IHDR.data.buffer);
    let off = 0;
    const width = dv.getUint32(off);
    off += 4;
    const height = dv.getUint32(off);
    off += 4;
    const bitDepth = dv.getUint8(off++);
    const colorType = dv.getUint8(off++);
    const compressionMethod = dv.getUint8(off++);
    const filterMethod = dv.getUint8(off++);
    const interlaceMethod = dv.getUint8(off++);
    console.log({
      width,
      height,
      bitDepth,
      colorType,
      compressionMethod,
      filterMethod,
      interlaceMethod,
    });
  }

  const decoded = decode(png);

  const reEncodeWithAdobe1998 = true;

  const iCCP = chunks.find((c) => c.name === "iCCP");
  let iCCP_dst;
  let srcProfile;
  if (iCCP) {
    const profile = decode_iCCP(iCCP.data);
    const profileBuf = inflate(profile.data);
    console.log(`Src Profile:`, profile.name);

    // Parse information
    const parsed = parseICC(Buffer.from(profileBuf));
    console.log(parsed);

    iCCP_dst = encode_iCCP({
      name: parsed.description,
      data: deflate(profileBuf),
    });

    srcProfile = new ColorEngine.Profile();
    await new Promise((r) => srcProfile.loadBinary(profileBuf, r));
  } else {
    srcProfile = "*sRGB";
  }

  if (reEncodeWithAdobe1998) {
    const colorTransform = new ColorEngine.Transform({
      buildLUT: true,
      dataFormat: "int8",
      BPC: true,
    });

    const dstProfileBuf = new Uint8Array(
      await (await fetch("/profiles/Adobe/AdobeRGB1998.icc")).arrayBuffer()
    );
    const dstProfile = new ColorEngine.Profile();
    await new Promise((r) => dstProfile.loadBinary(dstProfileBuf, r));
    const parsedDst = parseICC(Buffer.from(dstProfileBuf));
    console.log("Destination Profile:", parsedDst);

    const w = decoded.width;
    const h = decoded.height;
    const rgbData = new Uint8ClampedArray(w * h * 3);
    for (let i = 0; i < rgbData.length; i++) {
      rgbData[i * 3 + 0] = decoded.data[i * 4 + 0];
      rgbData[i * 3 + 1] = decoded.data[i * 4 + 1];
      rgbData[i * 3 + 2] = decoded.data[i * 4 + 2];
    }

    colorTransform.create(
      srcProfile,
      "*AdobeRGB",
      ColorEngine.eIntent.perceptual
    );

    const rgbOut = colorTransform.transformArray(
      rgbData,
      false,
      false,
      false,
      w * h,
      "int8"
    );

    console.log("RGB", rgbData);

    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < rgbData.length; i++) {
      rgba[i * 4 + 0] = rgbOut[i * 3 + 0];
      rgba[i * 4 + 1] = rgbOut[i * 3 + 1];
      rgba[i * 4 + 2] = rgbOut[i * 3 + 2];
      rgba[i * 4 + 3] = decoded.data[i * 4 + 3];
    }

    // re-encode and re-extract chunks
    chunks = extractChunks(encode({ ...decoded, data: rgba }));

    iCCP_dst = encode_iCCP({
      name: parsedDst.description,
      data: deflate(dstProfileBuf),
    });
  }

  createSaveSetup(async () => {
    const filename = `canvas-${Date.now()}.png`;
    // const png = await canvasToBuffer(canvas);

    const pixelsPerInch = 300;
    const pHYs = encode_pHYs_PPI(pixelsPerInch);
    const newChunks = withoutChunks(chunks, "pHYs");
    newChunks.splice(
      1,
      0,
      { name: "pHYs", data: pHYs },
      { name: "iCCP", data: iCCP_dst },
      {
        name: "iTXt",
        data: encode_iTXt({
          text: "hello world",
        }),
      }
    );

    const newPng = encodeChunks(newChunks);
    downloadBuffer(newPng, { filename });
    // exporter.write(png);
  });
}

setup();
