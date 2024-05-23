import { test } from "brittle";

import {
  encodeChunks,
  extractChunks,
} from "../src/png-metadata-writer/index.js";
import {
  decode_iTXt,
  encode_iTXt,
  encode_iCCP,
  encode_standardChromatics,
  encode_standardGamma,
  encode_pHYs_PPI,
} from "../../src/util.js";
import fs from "fs/promises";
import { parse as parseICC } from "icc";
import { inflate, deflate } from "pako";
import { encode } from "fast-png";
import paperSizes from "../src/paper-sizes.js";
import convertLength from "convert-length";

async function start() {
  const { dimensions, units } = paperSizes.a6;
  const pixelsPerInch = 300;
  const [width, height] = dimensions.map((d) =>
    convertLength(d, units, "px", { pixelsPerInch, roundPixel: true })
  );

  console.log("Dimensions:", dimensions.join(" x "), units);

  const data = new Uint8Array(4 * width * height);
  data.fill(0xff);

  const RGB = [233, 227, 213];
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 0] = RGB[0];
    data[i * 4 + 1] = RGB[1];
    data[i * 4 + 2] = RGB[2];
  }

  let png = encode({
    data,
    width,
    height,
  });

  const keyword = "metadata";

  let chunks = extractChunks(png);
  chunks = withoutChunks(chunks, ["iCCP", "gAMA", "cHRM", "sRGB", "pHYs"]);
  chunks = chunks.filter((c) => {
    if (c.name === "iTXt") {
      const d = decode_iTXt(c.data);
      if (d.keyword === keyword) {
        return false;
      }
    }
    return true;
  });

  const sRGB = await fs.readFile("test/fixtures/sRGB IEC61966-2.1.icc");
  const sRGBData = parseICC(sRGB);
  console.log("Color Profile:", sRGBData.description);
  const profile = encode_iCCP({
    name: sRGBData.description,
    data: deflate(sRGB),
  });

  const pHYs = encode_pHYs_PPI(pixelsPerInch);
  chunks.splice(
    1,
    0,
    { name: "gAMA", data: encode_standardGamma() },
    { name: "iCCP", data: profile },
    { name: "cHRM", data: encode_standardChromatics() },
    { name: "pHYs", data: pHYs },
    {
      name: "iTXt",
      data: encode_iTXt({
        keyword,
        text: "hello world",
      }),
    }
  );

  png = encodeChunks(chunks);
  await fs.writeFile("test/fixtures/test.png", png);
}

start();

function withoutChunks(chunks, nameFilter) {
  if (typeof nameFilter === "string") nameFilter = [nameFilter];
  return chunks.filter((c) => !nameFilter.includes(c.name));
}
