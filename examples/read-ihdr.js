import { colorTypeToChannels, colorTypeToString, readIHDR } from "../index.js";
import fs from "node:fs";

const input = process.argv[2];
if (!input)
  throw new Error(
    "Must specify an input, example:\n  node read-ihdr.js myfile.png"
  );

// The first 33 bytes of a PNG file are the header + IHDR
const byteCount = 33;
const bytes = await readBytes(input, byteCount);

// read IHDR chunk data
const data = readIHDR(bytes);

console.log(`Size: ${data.width} x ${data.height} px`);
console.log(
  `Format: ${colorTypeToString(data.colorType)} (${colorTypeToChannels(
    data.colorType
  )} channels)`
);
console.log(`Depth: ${data.depth} bpp`);

async function readBytes(path, nBytes) {
  const chunks = [];
  const stream = fs.createReadStream(path, {
    start: 0,
    end: nBytes - 1,
  });
  for await (let chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
