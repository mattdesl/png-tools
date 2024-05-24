import { deflate } from "pako";
import { parse as parseICC } from "icc";

import iccTransform from "./util/icc-transform.js";
import getDocument from "canvas-dimensions";
import fs from "node:fs/promises";
import {
  encode,
  ColorType,
  FilterMethod,
  colorTypeToChannels,
  encode_pHYs_PPI,
  ChunkType,
  encode_iCCP,
  colorTypeToString,
} from "../index.js";

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getTimestamp } from "./util/save.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const output = process.argv[2];
if (!output)
  throw new Error(
    "Must specify an output, example:\n  node encode-color-space.js tmp/out/dir"
  );

const r = await fs.stat(output);
if (!r.isDirectory())
  throw new Error(`Expected output to be a directory: ${output}`);

const size = {
  // Print size
  dimensions: "A2",
  pixelsPerInch: 300,
  units: "cm",
};

const {
  width: physicalWidth,
  height: physicalHeight,
  canvasWidth: width,
  canvasHeight: height,
  units,
  pixelsPerInch,
} = getDocument(size);

const options = {
  width,
  height,
  depth: 16,
  filter: FilterMethod.Paeth,
  colorType: ColorType.RGB,
  // Color space that the source pixels are in
  srcColorSpace: "display-p3",
  // Color space that the destination pixels are in
  dstColorSpace: "display-p3",
  // What PPI to embed the image with
  pixelsPerInch,
};

await run(options);

async function run(options) {
  const { colorType, depth, srcColorSpace, dstColorSpace } = options;

  console.log(
    "Size: %s x %s %s (%s PPI)",
    physicalWidth,
    physicalHeight,
    units,
    pixelsPerInch
  );
  console.log("Canvas Size: %s x %s px (%s bit)", width, height, depth);
  console.log(
    "Color Type: %s (%s channels)",
    colorTypeToString(colorType),
    colorTypeToChannels(colorType)
  );

  const data = createImage(options);

  const buf = await encodeForPrint(data, options, { level: 3 });

  const suffix =
    srcColorSpace === dstColorSpace
      ? srcColorSpace
      : `${srcColorSpace}-to-${dstColorSpace}`;

  const fname = `${getTimestamp()}-${depth}-bit-${suffix}.png`;
  const outFile = path.resolve(output, fname);
  console.log("Writing", fname);
  await fs.writeFile(outFile, buf);
}

function createImage(imageOptions) {
  const { width, height, depth, colorType } = imageOptions;
  const channels = colorTypeToChannels(colorType);
  const ArrayType = depth === 8 ? Uint8ClampedArray : Uint16Array;
  const maxValue = depth === 8 ? 0xff : 0xffff;
  let data = new ArrayType(width * height * channels).fill(maxValue);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const u = (x + 1) / width;
      const v = (y + 1) / height;
      const R = u;
      const G = 0.5;
      const B = v;
      data[i * channels + 0] = Math.round(R * maxValue);
      data[i * channels + 1] = Math.round(G * maxValue);
      data[i * channels + 2] = Math.round(B * maxValue);
    }
  }
  return data;
}

async function encodeForPrint(data, options, deflateOptions) {
  const profiles = {
    AdobeRGB1998: "AdobeRGB1998",
    sRGB: "sRGB IEC61966-2.1",
    "display-p3": "Display P3",
  };

  const {
    srcColorSpace = "sRGB",
    dstColorSpace = "sRGB",
    colorType,
    depth,
    pixelsPerInch,
  } = options;

  const channels = colorTypeToChannels(colorType);
  const maxValue = depth === 8 ? 0xff : 0xffff;

  const profileDir = path.join(__dirname, "./profiles");

  const srcProfileFname = profiles[srcColorSpace];
  if (!srcProfileFname) throw new Error(`no profile ${srcColorSpace}`);
  const dstProfileFname = profiles[dstColorSpace];
  if (!dstProfileFname) throw new Error(`no profile ${dstColorSpace}`);

  const srcProfile = await fs.readFile(
    path.resolve(profileDir, `${srcProfileFname}.icc`)
  );
  let dstProfile = srcProfile;

  // Color spaces do not match, we will convert A to B
  if (srcColorSpace !== dstColorSpace) {
    // Get the destination profile
    dstProfile = await fs.readFile(
      path.resolve(profileDir, `${dstProfileFname}.icc`)
    );

    // little-cms doesn't yet directly support for 16 bit, so if using that,
    // we will convert to float32 data and back
    let inData;
    if (depth === 8) {
      inData = data;
    } else {
      inData = new Float32Array(width * height * channels);
      for (let i = 0; i < data.length; i++) {
        inData[i] = fromByte(data[i]);
      }
    }

    // Apply the actual color space transform with little-cms (WASM)
    console.log(`Transforming ${srcColorSpace} to ${dstColorSpace}`);
    const result = await iccTransform({
      srcProfile: toArrayBuffer(srcProfile),
      dstProfile: toArrayBuffer(dstProfile),
      channels,
      width: width,
      height: height,
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

  const dstProfileCompressed = deflate(dstProfile, deflateOptions);
  const { description: dstProfileName } = parseICC(dstProfile);

  console.log("Destination Profile:", dstProfileName);

  console.log("Embedding ICC Profile:", dstProfileName);
  const iCCP = encode_iCCP({
    name: dstProfileName,
    data: dstProfileCompressed,
  });

  return encode(
    {
      ...options,
      data,
      ancillary: [
        { type: ChunkType.iCCP, data: iCCP },
        pixelsPerInch
          ? { type: ChunkType.pHYs, data: encode_pHYs_PPI(pixelsPerInch) }
          : false,
      ].filter(Boolean),
    },
    deflate,
    deflateOptions
  );

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
