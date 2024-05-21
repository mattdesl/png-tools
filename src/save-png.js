// import * as png from "@stevebel/png";
// import { COLOR_TYPES } from "@stevebel/png/lib/helpers/color-types";
import { extractChunks, encodeChunks } from "./png-metadata-writer";
import { deflate } from "pako";
// import { encode as pngEncode } from "fast-png";
import convert from "convert-length";

let link;
const noop = () => {};
const unitByteLookup = {
  m: 1,
  in: 2,
};

function saveBlob(blob, opts = {}) {
  return new Promise((resolve) => {
    const filename = opts.filename || "download.png";
    if (!link) {
      link = document.createElement("a");
      link.style.visibility = "hidden";
      link.target = "_blank";
    }
    link.download = filename;
    link.href = window.URL.createObjectURL(blob);
    document.body.appendChild(link);
    link.onclick = () => {
      link.onclick = noop;
      setTimeout(() => {
        window.URL.revokeObjectURL(blob);
        if (link.parentElement) link.parentElement.removeChild(link);
        link.removeAttribute("href");
        resolve({ filename });
      });
    };
    link.click();
  });
}

export async function saveCanvas(canvas, opts = {}) {
  const { id, metadata, filename } = opts;
  let fileWriter;
  if (typeof window.showSaveFilePicker === "function") {
    const handle = await window.showSaveFilePicker({
      startIn: "downloads",
      suggestedName: filename,
      excludeAcceptAllOption: true,
      id,
      types: [
        {
          description: "PNG Image",
          accept: {
            "image/png": [".png"],
          },
        },
      ],
    });

    fileWriter = await handle.createWritable();
  }

  const type = "image/png";
  const blob = await (canvas.convertToBlob
    ? canvas.convertToBlob(type)
    : new Promise((resolve) => canvas.toBlob(resolve, type)));
  const buf = new Uint8Array(await blob.arrayBuffer());
  const encoded = addMetadata(buf, metadata);
  if (fileWriter) {
    fileWriter.write(encoded);
    fileWriter.close();
  } else {
    const blob = new Blob([encoded], { type: "image/png" });
    return saveBlob(blob, { filename });
  }
}

export async function loadProfile(uri, name) {
  const resp = await fetch(uri);
  const buf = await resp.arrayBuffer();
  const data = deflate(buf);
  return { data, name };
}

function writeUInt32(uint8array, num, offset) {
  uint8array[offset] = (num & 0xff000000) >> 24;
  uint8array[offset + 1] = (num & 0x00ff0000) >> 16;
  uint8array[offset + 2] = (num & 0x0000ff00) >> 8;
  uint8array[offset + 3] = num & 0x000000ff;
}

function getProfileByteData(profileName, compressedData) {
  const nameBytes = convertStringToBytes(profileName).slice(0, 79);
  const buf = new Uint8Array(nameBytes.length + 2 + compressedData.length);
  buf.set(nameBytes, 0);
  buf.set(compressedData, nameBytes.length + 2);
  return buf;
}

export function addMetadata(encoded, metadata = {}) {
  const { profile, pixelsPerInch } = metadata;
  if (profile || pixelsPerInch) {
    const oldChunks = extractChunks(encoded).filter((c) => {
      const name = c.name;
      // discard existing profile/dimensions
      if (name === "iCCP" && profile) return false;
      if (name === "sRGB" && profile) return false;
      if (name === "pHYs" && pixelsPerInch) return false;
      return true;
    });

    let iCCP;
    if (profile) {
      iCCP = {
        name: "iCCP",
        data: getProfileByteData(profile.name, deflate(profile.data)),
      };
    }

    let pHYs;
    if (pixelsPerInch) {
      const units = "m";
      const ppu = convert(1, units, "px", { pixelsPerInch, roundPixel: true });

      const data = new Uint8Array(9);
      writeUInt32(data, ppu, 0);
      writeUInt32(data, ppu, 4);
      data[8] = 1; // meter unit

      pHYs = { name: "pHYs", data };
    }

    const extraChunks = [iCCP, pHYs].filter(Boolean);
    const newChunks = oldChunks.slice();
    newChunks.splice(1, 0, ...extraChunks);
    return encodeChunks(newChunks);
  } else {
    return encoded;
  }
}

function convertStringToBytes(val) {
  const data = new Uint8Array(val.length);
  for (let i = 0; i < val.length; i++) {
    data[i] = val.charCodeAt(i);
  }
  return data;
}
