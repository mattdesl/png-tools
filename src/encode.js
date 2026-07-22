import crc32 from "./crc32.js";
import { ChunkType, ColorType, PNG_HEADER } from "./constants.js";
import { encode_IHDR, encode_IDAT_raw } from "./chunks.js";

/**
 * @typedef {Object} EncodeOptions
 * @property {Uint8Array} data the raw pixel data to encode
 * @property {number} width the width of the image
 * @property {number} height the height of the image
 * @property {ColorType} [colorType=ColorType.RGBA] the color type of the pixel data
 * @property {number} [depth=8] the bit depth of the image
 * @property {number} [filterMethod=FilterMethod.Paeth] the filter method to use
 * @property {number} [firstFilter=filter] the first scanline filter method to use
 * @property {Chunk[]} [ancillary=[]] additional chunks to include in the PNG
 */

/**
 * Encodes a PNG buffer from the given image and options, using the specified `deflate` algorithm and optional compression options.
 * The deflate function should have the signature `(buf, [deflateOptions]) => Uint8Array`.
 *
 * @param {EncodeOptions} options the encoding options
 * @param {Function} deflate the sync deflate function to use
 * @param {Object} [deflateOptions] optional deflate options passed to the deflate() function
 */
export function encode(options = {}, deflate, deflateOptions) {
  const { data, ancillary = [], colorType = ColorType.RGBA } = options;
  if (!data) throw new Error(`must specify { data }`);
  if (!deflate) throw new Error(`must specify a deflate function`);
  if (options.interlace) {
    throw new Error("interlaced encoding is not currently supported");
  }
  if (colorType !== ColorType.RGB && colorType !== ColorType.RGBA) {
    throw new Error(
      "only RGB or RGBA colorType encoding is currently supported"
    );
  }
  return writeChunks([
    { type: ChunkType.IHDR, data: encode_IHDR(options) },
    ...ancillary,
    {
      type: ChunkType.IDAT,
      data: deflate(encode_IDAT_raw(data, options), deflateOptions),
    },
    { type: ChunkType.IEND },
  ]);
}

/**
 * Encodes just the raw PNG header into a Uint8Array buffer.
 * @returns {Uint8Array} the PNG header
 */
export function encodeHeader() {
  return PNG_HEADER.slice();
}

/**
 * Encodes a single PNG chunk into a Uint8Array buffer, by writing the chunk length, type, data, and CRC value.
 * @param {Chunk} chunk the chunk to encode
 * @returns {Uint8Array} the encoded chunk buffer
 */
export function encodeChunk(chunk) {
  const length = chunk.data ? chunk.data.length : 0;
  const output = new Uint8Array(4 + length + 4 + 4);
  const dv = new DataView(output.buffer, output.byteOffset, output.byteLength);
  // Write chunk length
  let idx = 0;
  encodeChunkRaw(output, dv, chunk, idx);
  return output;
}

/**
 * Writes and formats an array of PNG chunks into a complete PNG buffer, including the PNG header.
 *
 * @param {Chunk[]} chunks the array of chunks to encode
 * @returns {Uint8Array} the encoded PNG buffer
 */
export function writeChunks(chunks) {
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
    idx = encodeChunkRaw(output, dv, chunk, idx);
  }

  return output;
}

function encodeChunkRaw(output, dv, chunk, idx = 0) {
  // Write chunk length
  const length = chunk.data ? chunk.data.length : 0;
  dv.setUint32(idx, length);
  idx += 4;

  // Where the chunk index starts (before type code)
  const chunkStartIdx = idx;
  const chunkDataStartIdx = idx + 4;
  const chunkDataEndIdx = chunkDataStartIdx + length;

  // Write chunk type code
  const type = chunk.type;
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
