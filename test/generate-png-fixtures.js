import { pngs } from "./png-fixtures.js";
import { encode } from "fast-png"; // use a known encoder
import fs from "fs/promises";

for (let i = 0; i < pngs.length; i++) {
  try {
    const buf = encode(pngs[i]);
    await fs.writeFile(`test/fixtures/png/generated-${i}.png`, buf);
  } catch (err) {
    console.error(`Error on PNG index ${i}`);
    console.error(err);
  }
}
