import crc32 from "./src/crc32.js";

import { flattenBuffers, colorTypeToChannels } from "./src/util.js";

import { ChunkType, ColorType, FilterMethod, Intent } from "./src/constants.js";

import {
  encode,
  encodeHeader,
  encodeChunk,
  encodeChunks,
} from "./src/encode.js";

import { decodeChunks, readIHDR, pngChunkReader } from "./src/decode.js";

import {
  encode_IDAT_raw,
  encode_pHYs,
  encode_pHYs_PPI,
  encode_sRGB,
  encode_standardChromatics,
  encode_standardGamma,
  encode_iTXt,
  encode_IHDR,
  encode_iCCP,
  decode_iCCP,
  decode_iTXt,
  decode_IHDR,
  chunkFilter,
  chunkNameToType,
  chunkTypeToName,
  withoutChunks,
  matchesChunkType,
} from "./src/chunks.js";

export {
  // Utils
  crc32,
  flattenBuffers,
  colorTypeToChannels,

  // Export constants
  ChunkType,
  ColorType,
  FilterMethod,
  Intent,

  // Encoding
  encode,
  encodeHeader,
  encodeChunk,
  encodeChunks,

  // Decoding
  decodeChunks,
  readIHDR,
  pngChunkReader,

  // Chunk utils
  encode_IDAT_raw,
  encode_pHYs,
  encode_pHYs_PPI,
  encode_sRGB,
  encode_standardChromatics,
  encode_standardGamma,
  encode_iTXt,
  encode_IHDR,
  encode_iCCP,
  decode_iCCP,
  decode_iTXt,
  decode_IHDR,
  chunkFilter,
  chunkNameToType,
  chunkTypeToName,
  withoutChunks,
  matchesChunkType,
};
