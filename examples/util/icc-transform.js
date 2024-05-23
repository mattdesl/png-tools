import {
  instantiate,
  cmsFLAGS_NOCACHE,
  cmsFLAGS_HIGHRESPRECALC,
  cmsFLAGS_NOOPTIMIZE,
  cmsFLAGS_BLACKPOINTCOMPENSATION,
  cmsInfoDescription,
  INTENT_PERCEPTUAL,
} from "lcms-wasm";

export default async function iccTransform(opts = {}) {
  const lcms = await instantiate();
  const {
    data,
    width,
    height,
    intent = INTENT_PERCEPTUAL,
    blackPointCompensation = true,
  } = opts;
  const nPixels = width * height;
  const IS_FLOAT = data instanceof Float32Array;

  const srcProfile = openProfile(opts.srcProfile);
  const dstProfile = openProfile(opts.dstProfile);

  function openProfile(buf) {
    const profile = lcms.cmsOpenProfileFromMem(
      new Uint8Array(buf),
      buf.byteLength
    );
    if (!profile) throw new Error(`could not open profile ${path}`);
    return profile;
  }

  function getProfileName(profile) {
    return lcms.cmsGetProfileInfoASCII(profile, cmsInfoDescription, "en", "US");
  }

  const profiles = [srcProfile, dstProfile];
  profiles.forEach((c) =>
    console.log(
      `Loaded ${getProfileName(c)} (Color Space: ${lcms.cmsGetColorSpaceASCII(
        c
      )})`
    )
  );

  let flags = cmsFLAGS_NOCACHE | cmsFLAGS_HIGHRESPRECALC | cmsFLAGS_NOOPTIMIZE;
  if (blackPointCompensation) {
    flags |= cmsFLAGS_BLACKPOINTCOMPENSATION;
  }

  const inputFormat = lcms.cmsFormatterForColorspaceOfProfile(
    srcProfile,
    IS_FLOAT ? 4 : 1,
    IS_FLOAT
  );
  const outputFormat = lcms.cmsFormatterForColorspaceOfProfile(
    dstProfile,
    IS_FLOAT ? 4 : 1,
    IS_FLOAT
  );

  const transform = lcms.cmsCreateTransform(
    srcProfile,
    inputFormat,
    dstProfile,
    outputFormat,
    intent,
    flags
  );

  // Clean up the profiles once the transform is created
  lcms.cmsCloseProfile(srcProfile);
  lcms.cmsCloseProfile(dstProfile);

  const transformed = lcms.cmsDoTransform(transform, data, nPixels);
  return transformed;
}
