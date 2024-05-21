import { Deflate } from "pako";
import {
  deflateSync as fflateDeflate,
  deflate as deflateCb,
  zlib,
} from "fflate";
import { encode } from "../../src/png-io";
import { encode_IDAT_raw } from "../../src/util";

const deflateAsync = (d, opts = {}) =>
  new Promise((resolve, reject) =>
    deflateCb(d, opts, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    })
  );

// console.log("from worker");
self.onmessage = async (msg) => {
  const opts = msg.data;
  const zlibOpts = { level: 3 };
  const idat = encode_IDAT_raw(opts.data, opts);
  const deflator = new Deflate(zlibOpts);
  deflator.push(idat, opts.finish);
  if (deflator.err) {
    throw deflator.msg || msg[deflator.err];
  }
  const enc = deflator.result;
  self.postMessage(enc);
};
