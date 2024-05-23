import crc32 from "./crc32.js";
import { ChunkType, PNG_HEADER } from "./constants.js";
import { chunkTypeToName, decode_IHDR } from "./chunks.js";

export function readIHDR(buf, opts = {}) {
  let meta = {};
  pngChunkReader(buf, opts, (type, view) => {
    if (type === ChunkType.IHDR) {
      meta = decode_IHDR(view);
      return false; // stop reading the rest of PNG
    }
  });
  return meta;
}

export function decodeChunks(buf, opts = {}) {
  const chunks = [];
  pngChunkReader(buf, opts, (type, data) =>
    chunks.push({ type: chunkTypeToName(type), data: data.slice() })
  );
  return chunks;
}

export function pngChunkReader(buf, opts = {}, read = () => {}) {
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

  const { checkCRC = false } = opts;

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
      data.subarray(chunkDataIdx, chunkDataIdx + chunkLength)
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
