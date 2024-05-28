import { inflate } from "pako";
import {
  colorTypeToChannels,
  colorTypeToString,
  readChunks,
  decode_iCCP,
  ChunkType,
  decode_pHYs_PPI,
  decode_IHDR,
  decode_iTXt,
  chunkTypeToName,
} from "../index.js";
import fs from "node:fs/promises";
import { parse as parseICC } from "icc";

const input = process.argv[2];
if (!input)
  throw new Error(
    "Must specify an input, example:\n  node inspect.js myfile.png [icc_out.icc]"
  );

const icc = process.argv[3];

const buf = await fs.readFile(input);
const chunks = readChunks(buf, { copy: false });

const { width, height, colorType, depth } = decode_IHDR(
  chunks.find(chunkFilter(ChunkType.IHDR)).data
);

console.log(`Size: ${width} x ${height} px`);
console.log(
  `Format: ${colorTypeToString(colorType)} (${colorTypeToChannels(
    colorType
  )} channels)`
);
console.log(`Depth: ${depth} bpp`);

const pHYs = chunks.find(chunkFilter(ChunkType.pHYs));
if (pHYs) {
  console.log("pixelsPerInch:", Math.round(decode_pHYs_PPI(pHYs.data)));
}

const iCCP = chunks.find(chunkFilter(ChunkType.iCCP));
if (iCCP) {
  const { name, data } = decode_iCCP(iCCP.data);
  console.log("Embedded Profile:", name);

  // decompress to get the ICC color profile
  const profileDecompressed = Buffer.from(inflate(data));

  // if a subsequent input is given, it will write ICC out
  if (icc) await fs.writeFile(icc, profileDecompressed);

  // parse it with the 'icc' module to get more info
  const profileParsed = parseICC(profileDecompressed);
  console.log("Color Profile:", profileParsed);
} else {
  console.log("No color profile data");
}

const texts = [ChunkType.iTXt];
for (let type of texts) {
  const texts = chunks.filter(chunkFilter(type));
  if (texts.length) {
    console.log("%s:", chunkTypeToName(type));
  }
  for (let { data } of texts) {
    const txt = decode_iTXt(data);
    console.log(txt);
  }
}

function chunkFilter(type) {
  return (chunk) => chunk.type === type;
}
