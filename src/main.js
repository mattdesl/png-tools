import * as pako from "pako";
import { loadProfile, saveCanvas } from "./save-png";
import paperSizes from "./paper-sizes.js";
import convert from "convert-length";
import queryString from "query-string";

const exportOpts = {
  units: "m",
  pixelsPerInch: 300,
  roundPixel: true,
};

const $ = (s) => document.querySelector(s);

const parsed = queryString.parse(location.search);
const { paperSize = "A2", project = 1, mint = 0 } = parsed;

// find pixel units from physical
const size = paperSizes[paperSize.toLowerCase()];
const pixelHeight = convert(size.dimensions[1], size.units, "px", exportOpts);

const pixelsPerInch = 300;

const canvas = $("canvas");
const button = $(".download");
const loading = $(".loading");

const USE_OFFLINE = false;
let rawCanvas;
if (!USE_OFFLINE) rawCanvas = document.createElement("canvas");

let getProfile = (() => {
  let profile;
  return async () => {
    if (profile) return profile;
    profile = await loadProfile(
      "assets/sRGB IEC61966-2.1.icc",
      "sRGB IEC61966-2.1"
    );
    return profile;
  };
})();

var tokenData = {
  tokenId: 1000000 * parseInt(project, 10) + parseInt(mint, 10),
  externalAssetDependencies: [{ cid: "assets/FILIGREE" }],
  preferredIPFSGateway: "/",
};

$(".project").textContent = `Project: ${project}`;
$(".mint").textContent = `Mint: #${mint}`;
$(".tokenId").textContent = `Token: ${tokenData.tokenId}`;
$(".paper").textContent = `Print: ${paperSize.toUpperCase()} (approx)`;

const createCanvas = (w, h) => {
  if (USE_OFFLINE) return new OffscreenCanvas(w, h);
  else {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
};

window.tokenData = tokenData;
window.CONFIG = {
  AN: false, // disable animation
  AS: false, // disable auto saving on click
  AR: false, // disable auto resize
  ST: false, // remove styling
  R: pixelHeight, // fixed resolution
  F: () => {
    let bitmap;
    // finish function
    if (rawCanvas.transferToImageBitmap) {
      console.log("creating bitmap");
      bitmap = rawCanvas.transferToImageBitmap();
    } else {
      console.log("using full canvas");
      bitmap = rawCanvas;
    }
    const height = 2048;
    const width = height * (bitmap.width / bitmap.height);
    canvas.width = width;
    canvas.height = height;
    canvas.style.display = "";
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    doneLoad();
  },
  C: (w, h) => {
    // create canvas function
    rawCanvas = createCanvas(w, h);
    console.log("Canvas Size: (%d x %d)", w, h);

    const phys = [w, h].map((d) =>
      convert(d, "px", "cm", { precision: 1, pixelsPerInch })
    );
    console.log("Physical Size: %f x %f cm", ...phys);

    $(".size").textContent = `Size: ${phys[0]} x ${phys[1]} cm`;
    $(".pixelSize").textContent = `Dimensions: ${w} x ${h} px`;

    // Init sizing
    const hundred = "90%";
    const CS = canvas.style;
    const W = window;
    if (CS) {
      const resize = () => {
        CS.position = "absolute";
        CS.display = "block";
        CS.top = CS.left = CS.right = CS.bottom = "0";
        CS.margin = "auto";
        if (W.innerWidth / W.innerHeight <= w / h) {
          CS.width = hundred;
          CS.height = "auto";
        } else {
          CS.width = "auto";
          CS.height = hundred;
        }
      };
      W.onresize = resize;
      resize();
    }

    const PATCH_BG = false;
    if (PATCH_BG) {
      const getContext = rawCanvas.getContext.bind(rawCanvas);
      rawCanvas.getContext = function (type, opts = {}) {
        const ctx = getContext(type, opts);
        const fillRect = ctx.fillRect.bind(ctx);
        ctx.fillRect = (x, y, w, h) => {
          ctx.fillStyle = "#e9e3d5";
          return fillRect(x, y, w, h);
        };
        return ctx;
      };
    }
    return rawCanvas;
  },
  // Decompression routine
  D: async (url) => {
    const response = await fetch(url);
    const buf = await response.arrayBuffer();
    const res = pako.ungzip(buf);
    return res.buffer;
  },
};

button.onclick = async (ev) => {
  ev.preventDefault();
  loading.style.display = "";
  button.setAttribute("disabled", true);
  const tokenId = tokenData.tokenId;
  const filename = [tokenId, Date.now()].join("-") + ".png";
  const profile = await getProfile();

  // pixels per unit
  try {
    await saveCanvas(rawCanvas, {
      filename,
      metadata: {
        profile,
        pixelsPerInch,
      },
    });
  } catch (err) {
    console.warn(err.message);
  }
  // downloadFile(canvas.toDataURL(), );
  await new Promise((r) => setTimeout(r, 500));
  doneLoad();
};

function doneLoad() {
  loading.style.display = "none";
  button.removeAttribute("disabled");
}

// const save = () => {
//   downloadFile(canvas.toDataURL(), [tokenId, Date.now()].join("-") + ".png");
// };
