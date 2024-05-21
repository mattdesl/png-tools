import { test } from "brittle";
import {
  encode_iCCP,
  decode_iCCP,
  encode_iTXt,
  decode_iTXt,
} from "../src/util.js";
// import paperSizes from "../src/paper-sizes.js";
import fs from "fs/promises";
import { parse as parseICC } from "icc";
import { extractChunks } from "../src/png-metadata-writer/index.js";
import { inflate } from "pako";

// test("profile fixtures", async (t) => {
//   const buf = await fs.readFile("test/fixtures/test-icc.png");
//   const chunks = extractChunks(buf);
//   const a = Buffer.from(
//     inflate(decodeProfileData(chunks.find((f) => f.name == "iCCP").data).data)
//   );
//   await fs.writeFile("test/fixtures/sRGB IEC61966-2.1-written.icc", a);
//   // const a = await fs.readFile("test/fixtures/sRGB2014.icc");
//   const aDat = parseICC(a);
//   console.log(aDat);
// });

// test("paper sizes", (t) => {
//   t.alike(paperSizes.a4, { dimensions: [210, 297], units: "mm" });
//   t.alike(paperSizes.letter, { dimensions: [210, 297], units: "in" });
// });

test("profile data", (t) => {
  const enc = encode_iCCP({
    name: "Some Profile",
    data: new Uint8Array([4, 3, 1, 2]),
  });
  const data = decode_iCCP(enc);
  t.is(data.name, "Some Profile");
  t.is(data.compression, 0);
  t.alike(data.data, new Uint8Array([4, 3, 1, 2]));

  const long =
    "Some Profile With a Really Long Name This is Long Again Some Profile With a Really Long Name This is Long";
  const enc2 = encode_iCCP({ name: long, data: new Uint8Array([4, 3, 1, 2]) });
  const data2 = decode_iCCP(enc2);
  t.is(data2.name.length, 79);
  t.is(data2.compression, 0);
  t.alike(data2.data, new Uint8Array([4, 3, 1, 2]));
});

test("iTXt data", (t) => {
  const enc = encode_iTXt({
    keyword: "metadata",
    compressionFlag: 0,
    compressionMethod: 0,
    languageTag: "en",
    translatedKeyword: "test",
    text: "hello world",
  });
  const data = decode_iTXt(enc);
  t.alike(data, {
    keyword: "metadata",
    compressionFlag: 0,
    compressionMethod: 0,
    languageTag: "en",
    translatedKeyword: "test",
    text: "hello world",
  });
});
