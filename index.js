/**
 * @project png-tools
 * @author Matt DesLauriers (@mattdesl)
 * @license MIT see LICENSE.md file in GitHub repository
 */

import crc32 from "./src/crc32.js";

import {
  flattenBuffers,
  colorTypeToChannels,
  colorTypeToString,
} from "./src/util.js";

import { ChunkType, ColorType, FilterMethod, Intent } from "./src/constants.js";

import {
  encode,
  encodeHeader,
  encodeChunk,
  writeChunks,
} from "./src/encode.js";

import { readChunks, readIHDR, reader } from "./src/decode.js";

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
  decode_pHYs,
  decode_pHYs_PPI,
  chunkNameToType,
  chunkTypeToName,
} from "./src/chunks.js";

export {
  // Utils
  crc32,
  flattenBuffers,
  colorTypeToChannels,
  colorTypeToString,

  // Export constants
  ChunkType,
  ColorType,
  FilterMethod,
  Intent,

  // Encoding
  encode,
  encodeHeader,
  encodeChunk,
  writeChunks,

  // Decoding
  readChunks,
  readIHDR,
  reader,

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
  decode_pHYs,
  decode_pHYs_PPI,
  chunkNameToType,
  chunkTypeToName,
};
