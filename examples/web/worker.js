import { Deflate } from "pako";
import {
  ChunkType,
  encodeChunk,
  encodeHeader,
  encode_IDAT_raw,
  encode_IHDR,
  encode_pHYs_PPI,
} from "../../index.js";

self.onmessage = async (msg) => {
  const options = msg.data;
  const deflateOptions = { level: 3 };

  const postChunk = (progress, chunk) => {
    const finished = chunk.type === ChunkType.IEND;
    self.postMessage({ chunk: encodeChunk(chunk), progress, finished });
  };

  // 1. First post the raw header
  self.postMessage({ chunk: encodeHeader(), progress: 0, finished: false });

  // 2. Now post the metadata chunk
  postChunk(0, { type: ChunkType.IHDR, data: encode_IHDR(options) });

  // 2a (optional) Include any ancillary chunks like pixelsPerInch, text...
  if (options.pixelsPerInch) {
    postChunk(0, {
      type: ChunkType.pHYs,
      data: encode_pHYs_PPI(options.pixelsPerInch),
    });
  }

  // 3. Now do deflate, and each time the deflator gets compressed data,
  // send it to the main thread as well for writing
  const deflator = new Deflate(deflateOptions);
  const idat = encode_IDAT_raw(options.data, options);
  const totalSize = idat.byteLength;

  // Overload the function to extract each individual compressed chunk
  deflator.onData = function (chunk) {
    // ensure the Deflator has its chunks
    this.chunks.push(chunk);

    // Also push to the PNG stream while we are at it
    const progress = (totalSize - this.strm.avail_in) / totalSize;
    postChunk(progress, { type: ChunkType.IDAT, data: chunk });
  };

  // Push with 'finish' parameter as true
  deflator.push(idat, true);

  if (deflator.err) {
    throw deflator.msg || msg[deflator.err];
  }

  // 4. Finally, send the ending chunk as well
  postChunk(1, { type: ChunkType.IEND });
};
