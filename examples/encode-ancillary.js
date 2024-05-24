import {
  ChunkType,
  ColorType,
  colorTypeToChannels,
  encode,
  encode_iTXt,
  encode_pHYs_PPI,
} from "../index.js";
import { deflate } from "pako";
import fs from "node:fs/promises";
import { dirname } from "node:path";
import getDocument from "canvas-dimensions";

const output = process.argv[2];
if (!output)
  throw new Error(
    "Must specify an output, example:\n  node encode-ancillary.js myfile.png"
  );

const pixelsPerInch = 300;
const { canvasWidth: width, canvasHeight: height } = getDocument({
  dimensions: "A4",
  pixelsPerInch,
  units: "cm",
});

const colorType = ColorType.RGB;
const channels = colorTypeToChannels(colorType);
const data = new Uint8ClampedArray(width * height * channels);

// fill with pure black pixels
data.fill(0x00);

// encode an image
const buf = encode(
  {
    width,
    height,
    data,
    colorType,
    ancillary: [
      { type: ChunkType.pHYs, data: encode_pHYs_PPI(pixelsPerInch) },
      {
        // encode some JSON into the PNG as well for fun
        type: ChunkType.iTXt,
        data: encode_iTXt({
          keyword: "metadata",
          text: JSON.stringify({ seed: "some-random-seed" }),
        }),
      },
    ],
  },
  deflate
);

// mkdirp and write file
try {
  await fs.mkdir(dirname(output), { recursive: true });
} catch (err) {}
await fs.writeFile(output, buf);
