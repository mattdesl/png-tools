import {
  ColorType,
  FilterMethod,
  colorTypeToChannels,
  encodeChunk,
  encodeHeader,
  ChunkType,
  encode_IHDR,
  encode_IDAT_raw,
  colorTypeToString,
} from "../index.js";
import { Deflate } from "pako";
import fs from "node:fs";
import { dirname } from "node:path";
import { SingleBar } from "cli-progress";
import { splitPixels } from "./util/pixels.js";

const output = process.argv[2];
if (!output)
  throw new Error(
    "Must specify an output, example:\n  node encode-stream.js myfile.png"
  );

const width = 16000;
const height = 16000;
const colorType = ColorType.RGB;
const depth = 16;
const channels = colorTypeToChannels(colorType);
const filter = FilterMethod.None;
const deflateOptions = { level: 3 };

const ArrType = depth === 16 ? Uint16Array : Uint8ClampedArray;
const maxValue = depth === 16 ? 0xffff : 0xff;

const data = new ArrType(width * height * channels);

// quickly generate some image data
const tileSize = Math.floor(width * 0.1);
for (let y = 0; y < tileSize; y++) {
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < channels; c++) {
      const idx = x + y * height;
      const px = Math.floor(x / tileSize);
      const py = Math.floor(y / (tileSize / 2));
      const v = (px + py) % 2 === 0 ? maxValue : 0x00;
      data[idx * channels + c] = v;
    }
  }
}

// copy data across rest of buffer
const tileChunkSize = tileSize * width * channels;
let i = tileChunkSize;
while (i < data.length) {
  data.copyWithin(i, 0, tileChunkSize);
  i += tileChunkSize;
}

// our image options
const options = {
  width,
  height,
  depth,
  colorType,
  filter,
};

console.log(`Image Size: %s x %s px`, width, height);
console.log(`Depth: %s bpp`, depth);
console.log(`Color Type: %s`, colorTypeToString(colorType));

// mkdirp and create write stream
try {
  await fs.mkdir(dirname(output), { recursive: true });
} catch (err) {}

// show progress
const progressBar = new SingleBar();
progressBar.start(100, 0);

// create write stream
const stream = fs.createWriteStream(output);
stream.on("close", () => {
  console.log("File written to", output);
});

function writeChunk(chunk) {
  stream.write(encodeChunk(chunk));
}

console.time("encode");

// encode PNG header
stream.write(encodeHeader());

// encode metadata
writeChunk({
  type: ChunkType.IHDR,
  data: encode_IHDR(options),
});

// ... write any ancillary chunks ...

// create and write IDAT chunk
const deflator = new Deflate(deflateOptions);

// Number of pages worth of data to process at a time
// Note: you can simplify this code by just doing a single
// page and deflator.push(idat, true)
// The main benefits of splitting it up into pages:
// 1. less in memory at one time (for really huge images)
// 2. user isn't waiting a long time upfront
const pageCount = 4;

// current page and its total size
let page = 0;
let totalSize;

// Overload the function to extract each individual compressed chunk
deflator.onData = function (chunk) {
  // ensure the Deflator has its chunks
  this.chunks.push(chunk);

  // encode the current IDAT chunk
  writeChunk({ type: ChunkType.IDAT, data: chunk });

  // determine total progress
  const strmProgress = (totalSize - this.strm.avail_in) / totalSize;
  const progress = Math.round((100 * (page + strmProgress)) / pageCount);
  progressBar.update(progress);
};

// split whole stream into smaller sections
for (let { view, isLast } of splitPixels(
  data,
  width,
  height,
  channels,
  pageCount
)) {
  const idat = encode_IDAT_raw(view, {
    ...options,
    // Important: if you are going to do multiple separate IDAT chunks
    // you need to make sure the first scanline's filter is not one that
    // relies on the Up/Above scanline
    firstFilter: FilterMethod.Sub,
  });
  totalSize = idat.byteLength;
  deflator.push(idat, isLast);
  page++;
}

if (deflator.err) {
  throw deflator.msg || msg[deflator.err];
}

// write ending chunk
writeChunk({ type: ChunkType.IEND });

// stop progress
progressBar.stop();

// end stream
stream.end();
console.timeEnd("encode");
