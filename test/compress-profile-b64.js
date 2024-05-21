import { decode } from "fast-png";
import { extractChunks } from "../src/png-metadata-writer/index.js";
import { decode_iCCP, decode_iTXt } from "../src/util.js";
import fs from "fs/promises";
import { parse as parseICC } from "icc";
import { deflate, inflate } from "pako";
import { deflateSync, inflateSync } from "zlib";

const file = process.argv[2];
const outFile = process.argv[3];

const outDir = "src/profiles.js";
const profiles = (await fs.readdir("profiles/binary")).filter((c) =>
  c.endsWith(".icc")
);

// const buffers = [];
// for (let p of profiles) {
//   const buf = await fs.readFile(file);
//   const { description } = parseICC(buf);
//   const deflated = deflate(buf);
//   buffers.push()

//   await fs.writeFile(
//     "profiles/base64/" + description + ".js",
//     JSON.stringify(Buffer.from(deflated).toString("base64"))
//   );
//   // await fs.writeFile(
//   //   "profiles/base64/" + description + ".bin",
//   //   Buffer.from(deflated)
//   // );

// }
