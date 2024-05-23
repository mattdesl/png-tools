import crc32 from "./crc32.js";
import { ChunkType, ColorType, PNG_HEADER } from "./constants.js";
import { encode_IHDR, encode_IDAT_raw } from "./chunks.js";
import { chunkNameToType } from "./chunks.js";

export function encode(options = {}, deflate, deflateOptions) {
  const { data, ancillary = [], colorType = ColorType.RGBA } = options;
  if (!data) throw new Error(`must specify { data }`);
  if (!deflate) throw new Error(`must specify a deflate function`);
  if (colorType !== ColorType.RGB && colorType !== ColorType.RGBA) {
    throw new Error(
      "only RGB or RGBA colorType encoding is currently supported"
    );
  }
  return encodeChunks([
    { type: ChunkType.IHDR, data: encode_IHDR(options) },
    ...ancillary,
    {
      type: ChunkType.IDAT,
      data: deflate(encode_IDAT_raw(data, options), deflateOptions),
    },
    { type: ChunkType.IEND },
  ]);
}

export function encodeHeader() {
  return PNG_HEADER.slice();
}

export function encodeChunk(chunk) {
  const length = chunk.data ? chunk.data.length : 0;
  const output = new Uint8Array(4 + length + 4 + 4);
  const dv = new DataView(output.buffer, output.byteOffset, output.byteLength);
  // Write chunk length
  let idx = 0;
  writeChunk(output, dv, chunk, idx);
  return output;
}

export function encodeChunks(chunks) {
  let totalSize = PNG_HEADER.length; // start with header
  let idx = totalSize;
  for (let chunk of chunks) {
    totalSize += chunk.data ? chunk.data.length : 0;
    totalSize += 12; // length, code, CRC value (4 bytes each)
  }

  const output = new Uint8Array(totalSize);
  const dv = new DataView(output.buffer);

  // write header
  output.set(PNG_HEADER, 0);

  for (let chunk of chunks) {
    idx = writeChunk(output, dv, chunk, idx);
  }

  return output;
}

function writeChunk(output, dv, chunk, idx = 0) {
  // Write chunk length
  const length = chunk.data ? chunk.data.length : 0;
  dv.setUint32(idx, length);
  idx += 4;

  // Where the chunk index starts (before type code)
  const chunkStartIdx = idx;
  const chunkDataStartIdx = idx + 4;
  const chunkDataEndIdx = chunkDataStartIdx + length;

  // Write chunk type code
  const type =
    typeof chunk.type === "string" ? chunkNameToType(chunk.type) : chunk.type;
  dv.setUint32(chunkStartIdx, type);

  // Write chunk data
  if (chunk.data) output.set(chunk.data, chunkDataStartIdx);

  // get the whole chunk buffer including type
  const chunkBuf = output.subarray(chunkStartIdx, chunkDataEndIdx);

  // compute CRC and write it
  const crcValue = crc32(chunkBuf);
  dv.setInt32(chunkDataEndIdx, crcValue);

  // return next index for reading
  return chunkDataEndIdx + 4;
}
