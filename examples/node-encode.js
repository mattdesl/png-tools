import {
  ColorType,
  FilterMethod,
  colorTypeToChannels,
  encode,
} from "../index.js";
import { deflate } from "pako";
import fs from "node:fs/promises";
import { dirname } from "node:path";

const output = process.argv[2];
if (!output)
  throw new Error(
    "Must specify an output, example:\n  node node-encode.js myfile.png"
  );

// Encode faster but generates bigger files
const IS_FAST_MODE = true;

const width = 4096;
const height = 4096;
const colorType = ColorType.RGB;
const depth = 8;
const channels = colorTypeToChannels(colorType);

const ArrType = depth === 16 ? Uint16Array : Uint8ClampedArray;
const maxValue = depth === 16 ? 0xffff : 0xff;

const data = new ArrType(width * height * channels).fill(maxValue);

// create the first scanline of a gradient
for (let x = 0; x < width; x++) {
  const u = width <= 1 ? 1 : x / (width - 1);
  const color = Math.round(u * maxValue);
  for (let c = 0; c < channels; c++) {
    data[x * channels + c] = color;
  }
}

// now quickly repeat this across the rest of the height
for (let y = 1; y < height; y++) {
  const x = 0;
  const idx = x + y * width;
  data.copyWithin(idx * channels, 0, width * channels);
}

// encode an image
console.time("encode");
const buf = encode(
  {
    width,
    height,
    data,
    colorType,
    depth,
    // speed things up a little by using no filtering,
    // at the cost of filesize
    filter: IS_FAST_MODE ? FilterMethod.None : FilterMethod.Paeth,
  },
  deflate,
  { level: IS_FAST_MODE ? 3 : 6 }
);
console.timeEnd("encode");

// mkdirp and write file
try {
  await fs.mkdir(dirname(output), { recursive: true });
} catch (err) {}
await fs.writeFile(output, buf);
