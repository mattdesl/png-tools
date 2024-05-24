import {
  FilterMethod,
  colorTypeToChannels,
  encode_IDAT_raw,
  encode_iCCP,
  flattenBuffers,
} from "../../index.js";
import { Deflate, constants } from "pako";
import { adler32 } from "./adler32.js";

const DEFAULT_INITIAL_FILTER = FilterMethod.Sub;

self.onmessage = (msg) => {
  const options = msg.data;
  const {
    view,
    index,
    isFirst,
    isLast,
    deflateOptions,
    filter = FilterMethod.Paeth,
  } = options;

  let firstFilter;
  if (filter === FilterMethod.None || filter === FilterMethod.Sub) {
    firstFilter = filter;
  } else {
    firstFilter = DEFAULT_INITIAL_FILTER;
  }

  let idat = encode_IDAT_raw(view, {
    ...options,
    // Important: we need to encode the chunk with the first scanline filter being one that
    // is safe, i.e. not relying on any pixel data 'up' or 'above'
    firstFilter,
  });

  const zChunks = [];

  const totalSize = idat.byteLength;

  let deflate = new Deflate({ ...deflateOptions, raw: true });

  deflate.onData = function (zChunk) {
    zChunks.push(zChunk);
    const progress = (totalSize - this.strm.avail_in) / totalSize;
    self.postMessage({ progress });
  };
  deflate.push(idat, false);
  if (isLast) deflate.push([], constants.Z_FINISH);
  else deflate.push([], constants.Z_FULL_FLUSH);

  if (isFirst) {
    // push header
    let deflate = new Deflate(deflateOptions);
    deflate.push([], true);
    zChunks.unshift(deflate.result.slice(0, 2));
  }

  let result = flattenBuffers(zChunks);
  const adler = adler32(idat);

  self.postMessage({ index, result, adler, size: idat.byteLength });
};
