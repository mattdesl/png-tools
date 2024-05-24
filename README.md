# png-tools

A suite of low level tools for working with print-quality PNG files in JavaScript. This is not a fully featured encoder or decoder, but a set of utilities that allow for some specific use cases around performance, print resolution, color profile embedding, streaming, and other tasks.

Some features:

- Compatible with web, node, deno, bun
- Highly optimised; sometimes 2-6 times faster than [fast-png](https://www.npmjs.com/package/fast-png)
- Streamable and cancellable (e.g. WebWorkers and File System API streaming for massive files)
- Allows embedding color profile and DPI metadata for print-ready files
- Utilities for inspecting and modifying PNG chunks

Some things that are not yet supported:

- Translating IDAT chunks into pixel data (un-filtering)
- Extracting palette values for indexed PNGs
- Encoding colorType other than RGB and RGBA
- Utilities around encoding and decoding certain rarely used ancillary chunks

## Docs

See [./DOCUMENTATION.md](./DOCUMENTATION.md).

## Recipes

### Encode Pixel Data

For RGB and RGBA data, you can use the helper function. You are expected to 'bring your own DEFLATE', a good option is pako.

```js
import { encode } from "png-tools";
import { deflate } from "pako";

const image = {
  width: 256,
  height: 128,
  data: rgbaPixelData,
};

const buf = encode(image, deflate);
// => Uint8Array
```

See [examples/encode-image.js](./examples/encode-image.js) for a full example.

### More Encoding Options

You can encode RGB or RGBA, and 8 or 16 bits, with a different filter method that is applied to all scanlines. You can also specify a list of `ancillary` chunks which are inserted prior to image data (IDAT) chunks.

```js
import {
  encode,
  FilterMethod,
  ColorType,
  ChunkType,
  encode_pHYs_PPI,
} from "png-tools";

import { deflate } from "pako";

const pixelsPerInch = 300;

// more options
const image = {
  width,
  height,
  data: rgbPixelData,
  depth: 16,
  filter: FilterMethod.None,
  colorType: ColorType.RGB,
  ancillary: [
    // include DPI information in the PNG
    {
      type: ChunkType.pHYs,
      data: encode_pHYs_PPI(pixelsPerInch),
    },
  ],
};

buf2 = encode(image, deflate, {
  /* deflateOptions */
  level: 3,
});
```

See [examples/encode-ancillary.js](./examples/encode-ancillary.js) for a full example.

### Reading PNG Metadata

You can read the `IHDR` tag (metadata) without having to decode the entire PNG file. This entire header + metadata chunk should be exactly 33 bytes in a well formed PNG file.

```js
import { readIHDR } from "png-tools";
import fs from "node:fs/promises";

const buf = await fs.readFile("image.png");
const { width, height, colorType, depth } = readIHDR(buf);
```

See [examples/read-ihdr.js](./examples/read-ihdr.js) for a full example, that also only reads the first 33 bytes of the file rather than buffering it entirely into memory.

### Modifying PNG Chunks

If you already have a PNG file, for example from `Canvas.toBlob()`, you can remove/insert chunks without having to re-filter and re-encode the pixel data. This is generally _much_ faster than decoding and re-encoding the entire image data.

```js
import {
  decodeChunks,
  encodeChunks,
  withoutChunks,
  ChunkType,
  encode_pHYs_PPI,
} from "png-tools";

import { canvasToBuffer } from "png-tools/canvas.js";

// promise wrapper around canvas.toBlob() -> Uint8
let buffer = await canvasToBuffer(canvas);

// decode buffer into chunks
let chunks = decodeChunks(buffer);

// strip out an existing pHYs chunk if it exists
chunks = withoutChunks(chunks, ChunkType.pHYs);

// include the new chunk
chunks.splice(1, 0, {
  type: ChunkType.pHYs,
  data: encode_pHYs_PPI(pixelsPerInch),
});

// your final buffer
buffer = encodeChunks(chunks);
```

### Streaming Encoding

You can manually build up a set of chunks, either to buffer into an array, or stream directly into a file. This can be combined with WebWorkers and File System API on the web for a very efficient and low-memory encoding system, with a good UX that includes progress reporting and cancellation.

```js
import {
  ChunkType,
  encodeChunk,
  encodeHeader,
  encode_IHDR,
  encode_IDAT_raw,
} from "png-tools";

import { deflate } from "pako";

function write(buf) {
  // send contents to your file or buffer
}

function writeChunk(chunk) {
  write(encodeChunk(chunk));
}

const image = {
  data,
  width,
  height,
  depth,
  colorType,
};

// encode PNG header
write(encodeHeader());

// encode metadata
writeChunk({
  type: ChunkType.IHDR,
  data: encode_IHDR(image),
});

// ... write any ancillary chunks ...

// create and write IDAT chunk
const idat = encode_IDAT_raw(image.data, image);
const compressed = deflate(idat);
writeChunk({
  type: ChunkType.IDAT,
  data: compressed,
});

// write ending chunk
writeChunk({ type: ChunkType.IEND });
```

See [examples/encode-stream.js](./examples/encode-stream.js) for a more complete example, using `pako.Deflate` and streaming the compressed data directly into a file.

### Reading ICC Color Profile Data

You can also use this library to inspect and extract the color profile chunk (iCCP), if one exists.

```js
import { decodeChunks, chunkFilter, ChunkType, decode_iCCP } from "png-tools";
import { inflate } from "pako";
import { parse as parseICC } from "icc";
import fs from "node:fs/promises";

const buf = await fs.readFile("image.png");
const chunks = decodeChunks(buf);
const chunk = chunks.find(chunkFilter(ChunkType.iCCP));
if (chunk) {
  const { name, data } = decode_iCCP(chunk.data);
  console.log("Embedded Profile:", name);

  // decompress to get the ICC color profile
  const profileDecompressed = Buffer.from(inflate(data));

  // write it to a file
  await fs.writeFile("image.icc", profileDecompressed);

  // parse it with the 'icc' module to get more info
  const profileParsed = parseICC(profileDecompressed);
  console.log("Color Profile:", profileParsed);
} else {
  console.log("No color profile data");
}
```

### Embedding Color Profiles like `display-p3`

This is easily done with `encode()`. It must be manually spliced into the beginning of the array if you are re-coding an existing PNG buffer.

```js
import { deflate } from "pako";
import { encode_iCCP, ChunkType, encode } from "png-tools";

const iccFile = await fs.readFile("Display P3.icc");
const name = "Display P3";
const data = deflate(iccFile);

const iCCP = {
  type: ChunkType.iCCP,
  data: encode_iCCP({ name, data }),
};

// encode some image data with an ancilary chunk
buf = encode({
  width,
  height,
  data,
  ancillary: [iCCP],
});
```

### Color Space Transformation

Color space transformation is out of scope of this library, but an example using `lcms-wasm` is included in [./examples/color-space.js](./examples/color-space.js).

## Optimisations

For faster encoding, you can do a few things:

### Canvas.toBlob()

If you are working in the browser with 8-bit color data, you can use HTML5 Canvas2D's native PNG encoder which is highly optimised. This will give you a PNG buffer, which you can then extend with additional chunks (such as resolution and color profile) without having to re-filter and re-compress the pixel data, which is the most expensive step.

```js
import { createCanvas, canvasToBuffer } from "png-tools/canvas.js";

// If you have a canvas already, you should skip this step
// But if you only have pixel data, you can convert it like so:
const canvas = createCanvas(data);

// encode as PNG, letting the browser do the hard work
let buffer = await canvasToBuffer(canvas);

// now we can extract the chunks
let chunks = decodeChunks(buffer);

// ... do something with the chunks

// and re-encode the chunks (does not re-compress the data stream)
buffer = encodeChunks(chunks);
```

### WebWorkers

Workers will only marginally increase encoding or decoding time, but will stop the UI from halting, giving you a way to provide a visual progress indicator and even task cancellation. This will help provide the _feeling_ of improved speed. See the worker example in [examples/index.html](./examples/index.html).

### Faster Compression

When using `encode()`, you can lower the compression level which will increase speed at the cost of file size.

```js
import { deflate } from "pako";

buf = encode(myImage, deflate, { level: 3 });
```

### Reduce the Bits

Writing less bits will be faster, so 8 bit image will be much faster than 16, and `ColorType.RGB` will be faster than `ColorType.RGBA`, if you do not need an alpha channel.

### Filter Methods

Filtering can be expensive on large images, and is only done to improve compression ratios. If you don't care about file size, you can turn it off for a faster encoding. However, in some cases, turning this off will slow down the total encoding time, as the compressor will now have more work to do. This depends heavily on your particular image and settings. The default filter is `Paeth`, which is applied to every scanline.

```js
import { FilterMethod } from "png-tools";

buf = encode(
  {
    width: 256,
    height: 128,
    filter: FilterMethod.None,
  },
  deflate
);
```

## License

MIT, see [LICENSE.md](http://github.com/mattdesl/png-tools/blob/master/LICENSE.md) for details.
