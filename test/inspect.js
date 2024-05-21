// A CLI tool to inspect color profiles in PNGs
// node test/inspect.js test/fixtures/Red-Display-P3.png

import { decode } from "fast-png";
import { extractChunks } from "../src/png-metadata-writer/index.js";
import { decode_iCCP, decode_iTXt } from "../src/util.js";
import fs from "fs/promises";
import { parse as parseICC } from "icc";
import { inflate } from "pako";

async function inspect(file, iccOut) {
  const buf = await fs.readFile(file);
  if (file.endsWith(".icc")) {
    const profileParsed = parseICC(buf);
    console.log("Color Profile:", profileParsed);
  } else {
    const chunks = extractChunks(buf);
    const iCCP = chunks.find((c) => c.name === "iCCP");
    if (iCCP) {
      const { name, compression, data } = decode_iCCP(iCCP.data);
      console.log("Embedded Profile:", name);

      const profileDecompressed = inflate(data);
      console.log(compression, data);
      const profileParsed = parseICC(Buffer.from(profileDecompressed));
      console.log("Color Profile:", profileParsed);
      if (iccOut) {
        await fs.writeFile(iccOut, profileDecompressed);
      }
    } else {
      console.log("No color profile data");
    }

    const iTXts = chunks.filter((c) => c.name === "iTXt");
    for (let iTXt of iTXts) {
      // const data = decode_iTXt(iTXt.data);
      // console.log("iTXt Data:", data);
    }

    const { data, width, height } = decode(buf);
    console.log("Size: %d x %d px", width, height);
    console.log("Data:", data.slice(0, 4), " ...");
  }
}

if (!process.argv[2]) throw new Error("no file specified");
inspect(process.argv[2], process.argv[3]);
