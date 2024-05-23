import { deflate } from "pako";
import { encode } from "fast-png";
import { parse as parseICC } from "icc";
import { encode_iCCP, encode_pHYs_PPI, withoutChunks } from "../../src/util.js";
import {
  extractChunks,
  encodeChunks,
} from "../src/png-metadata-writer/index.js";
import iccTransform from "../util/icc-transform.js";
import getDocument from "canvas-dimensions";
import fs from "node:fs/promises";

async function setup() {
  const { width, height, canvasWidth, canvasHeight, pixelsPerInch, units } =
    getDocument({
      dimensions: "a4",
      units: "cm",
      pixelsPerInch: 300,
    });

  console.log("Size: %s x %s %s (%s PPI)", width, height, units, pixelsPerInch);
  console.log("Canvas Size: %s x %s px", canvasWidth, canvasHeight);

  const depth = 16;

  // This is our desired *output* space that is transformed and embedded
  // We can leave it as display-p3 for screen, or if the file is going to print,
  // we may want to use Adobe RGB (1998), Pro Photo, eciRGB_v2_profile
  const srcColorSpace = "display-p3";
  const dstColorSpace = "AdobeRGB1998";

  const dtypeArray = depth === 8 ? Uint8ClampedArray : Uint16Array;
  const maxValue = depth === 8 ? 0xff : 0xffff;

  const channels = 3;
  let data = new dtypeArray(canvasWidth * canvasHeight * channels);
  for (let y = 0, i = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++, i++) {
      const u = (x + 1) / canvasWidth;
      const v = (y + 1) / canvasHeight;
      const R = u;
      const G = 0.5;
      const B = v;
      data[i * channels + 0] = toByte(R);
      data[i * channels + 1] = toByte(G);
      data[i * channels + 2] = toByte(B);
    }
  }

  const profiles = {
    AdobeRGB1998: "AdobeRGB1998",
    sRGB: "sRGB IEC61966-2.1",
    "display-p3": "Display P3",
  };

  const srcProfileFname = profiles[srcColorSpace];
  if (!srcProfileFname) throw new Error(`no profile ${srcColorSpace}`);
  const dstProfileFname = profiles[dstColorSpace];
  if (!dstProfileFname) throw new Error(`no profile ${dstColorSpace}`);

  const srcProfile = await fs.readFile(`profiles/raw/${srcProfileFname}.icc`);
  let dstProfile = srcProfile;

  if (srcColorSpace !== dstColorSpace) {
    dstProfile = await fs.readFile(`profiles/raw/${dstProfileFname}.icc`);

    let inData;
    if (depth === 8) inData = data;
    else {
      inData = new Float32Array(canvasWidth * canvasHeight * channels);
      for (let i = 0; i < data.length; i++) {
        inData[i] = fromByte(data[i]);
      }
    }

    console.log(`Transforming ${srcColorSpace} to ${dstColorSpace}`);
    const result = await iccTransform({
      srcProfile: toArrayBuffer(srcProfile),
      dstProfile: toArrayBuffer(dstProfile),
      channels,
      width: canvasWidth,
      height: canvasHeight,
      data: inData,
    });

    // bring the result from float back to 16 bit
    if (depth === 8) {
      data = result;
    } else {
      if (data.length !== result.length)
        throw new Error("data and transformed result size mismatch");
      for (let i = 0; i < data.length; i++) {
        data[i] = toByte(result[i]);
      }
    }
  }

  const profileCompressed = deflate(dstProfile);
  const { description: profileName } = parseICC(dstProfile);

  let png = encode({
    data,
    channels,
    width: canvasWidth,
    height: canvasHeight,
    depth,
  });

  let chunks = extractChunks(png);

  // strip color profile and physical units
  chunks = withoutChunks(chunks, ["iCCP", "pHYs"]);

  // splice the new chunks back in
  chunks.splice(
    1,
    0,
    {
      name: "iCCP",
      data: encode_iCCP({ name: profileName, data: profileCompressed }),
    },
    { name: "pHYs", data: encode_pHYs_PPI(pixelsPerInch) }
  );

  console.log("Embedding ICC Profile:", profileName);

  // re-encode the PNG
  png = encodeChunks(chunks);

  const suffix =
    srcColorSpace === dstColorSpace
      ? srcColorSpace
      : `${srcColorSpace}-to-${dstColorSpace}`;
  await fs.writeFile(`test/fixtures/demo-${depth}-bit-${suffix}.png`, png);

  function toByte(v) {
    return Math.max(0, Math.min(maxValue, Math.round(v * maxValue)));
  }

  function fromByte(b) {
    return b / maxValue;
  }

  function toArrayBuffer(buffer) {
    const arrayBuffer = new ArrayBuffer(buffer.length);
    const view = new Uint8Array(arrayBuffer);
    for (let i = 0; i < buffer.length; ++i) {
      view[i] = buffer[i];
    }
    return arrayBuffer;
  }
}

setup();
