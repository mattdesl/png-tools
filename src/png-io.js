import crc32_buf from "./crc32.js";
import {
  colorTypeToChannels,
  decode_IHDR,
  encode_IDAT_raw,
  encode_IHDR,
} from "./util.js";
import { Intent, ColorType, ChunkType, FilterType } from "./constants.js";

export { Intent, ColorType, ChunkType, FilterType };

const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function matchesChunkType(a, b) {
  if (a == null || b == null)
    throw new Error(
      `chunk type does not exist; maybe a spelling mistake in ChunkType enum?`
    );
  const aType = typeof a === "string" ? chunkNameToType(a) : a;
  const bType = typeof b === "string" ? chunkNameToType(b) : b;
  return aType === bType;
}

export function chunkFilter(type) {
  if (!type) throw new Error("Must specify a type parameter");
  const types = Array.isArray(type) ? type : [type];
  return (c) => types.some((n) => matchesChunkType(c.type, n));
}

export function withoutChunks(chunks, type) {
  const filter = chunkFilter(type);
  return chunks.filter((c) => !filter(c));
}

export function chunkTypeToName(type) {
  return String.fromCharCode(
    (type >> 24) & 0xff,
    (type >> 16) & 0xff,
    (type >> 8) & 0xff,
    type & 0xff
  );
}

export function chunkNameToType(name) {
  if (name.length !== 4) {
    throw new Error("Chunk name must be exactly 4 characters");
  }
  return (
    (name.charCodeAt(0) << 24) |
    (name.charCodeAt(1) << 16) |
    (name.charCodeAt(2) << 8) |
    name.charCodeAt(3)
  );
}

export function decodeChunks(buf, opts = {}) {
  const chunks = [];
  pngChunkReader(buf, opts, (type, data) =>
    chunks.push({ type: chunkTypeToName(type), data: data.slice() })
  );
  return chunks;
}

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
  const crcValue = crc32_buf(chunkBuf);
  dv.setInt32(chunkDataEndIdx, crcValue);

  // return next index for reading
  return chunkDataEndIdx + 4;
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
      let crcExpect = crc32_buf(chunkBuffer);
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
