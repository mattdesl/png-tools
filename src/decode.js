import crc32 from "./crc32.js";
import { ChunkType, PNG_HEADER } from "./constants.js";
import { chunkTypeToName, decode_IHDR } from "./chunks.js";

/**
 * @typedef {Object} PNGReaderOptions
 * @property {boolean} [checkCRC=false] whether to check and verify CRC values of each chunk (slower but can detect errors and corruption earlier during parsing)
 * @property {boolean} [copy=true] whether to return a sliced copy of each chunk data instead of a shallow subarray view into the input buffer
 **/

/**
 * Reads a PNG buffer up to the end of the IHDR chunk and returns this metadata, giving its width, height, bit depth, and color type.
 *
 * @param {ArrayBufferView} buf the PNG buffer to read
 * @param {PNGReaderOptions} [opts={}] optional parameters for reading
 * @returns {IHDRData}
 **/
export function readIHDR(buf, opts = {}) {
  let meta = {};
  reader(buf, { ...opts, copy: false }, (type, view) => {
    if (type === ChunkType.IHDR) {
      meta = decode_IHDR(view);
      return false; // stop reading the rest of PNG
    }
  });
  return meta;
}

/**
 * Parses a PNG buffer and returns an array of chunks, each containing a type code and its data.
 * The individual chunks are not decoded, but left as raw Uint8Array data. If `copy` option is `false`,
 * the chunk data is a view into the original ArrayBufferView (no copy involved), which is more memory efficient
 * for large files.
 *
 * @param {ArrayBufferView} buf
 * @param {PNGReaderOptions} [opts={}] optional parameters for reading PNG chunks
 * @returns {Chunk[]} an array of chunks
 */
export function readChunks(buf, opts = {}) {
  const chunks = [];
  reader(buf, opts, (type, data) => chunks.push({ type, data }));
  return chunks;
}

/**
 * A low-level interface for stream reading a PNG file. With the speicifed buffer, this function reads
 * each chunk and calls the `read(type, data)` function, which is expected to do something with the chunk data.
 * If the `read()` function returns `false`, the stream will stop reading the rest of the PNG file and safely end early,
 * otherwise it will expect to end on an IEND type chunk to form a valid PNG file.
 *
 * @param {ArrayBufferView} buf
 * @param {PNGReaderOptions} [opts={}] optional parameters for reading PNG chunks
 * @returns {Chunk[]} an array of chunks
 */
export function reader(buf, opts = {}, read = () => {}) {
  if (!ArrayBuffer.isView(buf)) {
    throw new Error("Expected a typed array such as Uint8Array");
  }

  if (typeof opts === "function") {
    read = opts;
    opts = {};
  }

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const data = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);

  if (data.length < PNG_HEADER.length) {
    throw new Error(`Buffer too small to contain PNG header`);
  }

  const { checkCRC = false, copy = true } = opts;

  for (let i = 0; i < PNG_HEADER.length; i++) {
    if (data[i] !== PNG_HEADER[i]) throw new Error(`Invalid PNG file header`);
  }

  let ended = false;
  let hasMetIHDR = false;
  let idx = 8;
  while (idx < data.length) {
    // Length of current chunk
    const chunkLength = dv.getUint32(idx);
    idx += 4;

    // Extract 4-byte type code
    const type = dv.getUint32(idx);

    // First chunk must be IHDR
    if (!hasMetIHDR) {
      if (type !== ChunkType.IHDR) throw new Error("Invalid PNG: IHDR missing");
      hasMetIHDR = true;
    }

    const chunkDataIdx = idx + 4;
    if (checkCRC) {
      // Get the chunk contents including the type code but not CRC code
      const chunkBuffer = data.subarray(idx, chunkDataIdx + chunkLength);

      // Int32 CRC value that comes after the chunk data
      const crcCode = dv.getInt32(chunkDataIdx + chunkLength);
      let crcExpect = crc32(chunkBuffer);
      if (crcExpect !== crcCode) {
        throw new Error(
          `CRC value for ${chunkTypeToName(
            type
          )} does not match, PNG file may be corrupted`
        );
      }
    }

    // parse the current chunk
    const v = read(
      type,
      copy
        ? data.slice(chunkDataIdx, chunkDataIdx + chunkLength)
        : data.subarray(chunkDataIdx, chunkDataIdx + chunkLength)
    );
    if (v === false || type === ChunkType.IEND) {
      // safely end the stream
      ended = true;
      break;
    }

    // Skip past the chunk data and CRC value
    idx = chunkDataIdx + chunkLength + 4;
  }

  if (!ended) {
    throw new Error("PNG ended without IEND chunk");
  }
}
