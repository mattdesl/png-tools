const deflateAsync = (d, opts = {}) =>
  new Promise((resolve, reject) =>
    deflateCb(d, opts, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    })
  );

function encodeSplit(data, debug = true) {
  const options = {
    width,
    height,
    depth,
    colorType,
  };

  const chunks = [{ type: ChunkType.IHDR, data: encode_IHDR(options) }];
  const splitCount = Math.max(8, navigator.hardwareConcurrency);

  let progress = 0;
  let index = 0;

  // modify deflator so that we can save individual chunks
  const deflator = new pako.Deflate({ level: 3 });
  deflator.onData = function (chunk) {
    this.chunks.push(chunk);
    chunks.push({ type: ChunkType.IDAT, data: chunk });
  };

  for (let chunk of splitPixels(data, width, height, channels, splitCount)) {
    const sliceIndex = index++;
    const isFinish = sliceIndex === splitCount - 1;
    const enc = encode_IDAT_raw(chunk, options);
    deflator.push(enc, isFinish);
    progress++;
    console.log("Progress:", Math.round((progress / splitCount) * 100) + "%");
  }

  chunks.push({ type: ChunkType.IEND });
  return encodeChunks(chunks);
}

async function encodeStream(data, debug = true) {
  const options = {
    width,
    height,
    depth,
    colorType,
  };

  const chunks = [{ type: ChunkType.IHDR, data: encode_IHDR(options) }];
  const splitCount = 1; //Math.max(8, navigator.hardwareConcurrency);

  let progress = 0;
  const idats = await new Promise((resolve) => {
    const list = [];
    let index = 0;
    for (let chunk of splitPixels(data, width, height, channels, splitCount)) {
      // create a new chunk
      const worker = new Worker(new URL("./idat.js", import.meta.url), {
        type: "module",
      });

      // we need to slice it to ensure we aren't transferring the same shared buffer
      const slice = chunk.slice();
      const sliceIndex = index++;
      console.log("CurSlice", slice);
      worker.postMessage(
        {
          ...options,
          data: slice,
          index: sliceIndex,
          finish: sliceIndex === splitCount - 1,
        },
        [slice.buffer]
      );
      worker.addEventListener(
        "message",
        (ev) => {
          progress++;
          if (debug) {
            console.log(
              "Progress:",
              Math.round((progress / splitCount) * 100) + "%"
            );
          }
          list.push({ type: ChunkType.IDAT, data: ev.data, index: sliceIndex });
          if (list.length === splitCount) {
            // sort to ensure correct image order
            list.sort((a, b) => a.index - b.index);
            resolve(list);
          }
        },
        { once: true }
      );
    }
  });

  for (let idat of idats) chunks.push(idat);
  chunks.push({ type: ChunkType.IEND });
  return encodeChunks(chunks);
}

function verifyEncoded(enc) {
  const chunks = decodeChunks(enc);
  const options = decode_IHDR(chunks.find(chunkFilter(ChunkType.IHDR)).data);
  console.log("Verifying", options);

  const inflate = new pako.Inflate({ level: 3 });
  const idats = chunks.filter(chunkFilter(ChunkType.IDAT));
  for (let i = 0; i < idats.length; i++) {
    const c = idats[i];
    inflate.push(c.data, i === idats.length - 1);
  }
  if (inflate.err) throw inflate.err;
  console.log(inflate.result);
}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;

  // If you don't care about the order of the elements inside
  // the array, you should sort both arrays here.
  // Please note that calling sort on an array will modify that array.
  // you might want to clone your array first.

  for (var i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
