/** Bounded, inert image sources shared by the browser and save/publication validator. */
export const MAX_IMAGE_BYTES = 1_000_000;
const MAX_PIXELS = 24_000_000;
const ascii = (bytes, from, to) =>
  String.fromCharCode(...bytes.subarray(from, to));
const be16 = (b, i) => b[i] * 256 + b[i + 1];
const be32 = (b, i) =>
  b[i] * 16777216 + b[i + 1] * 65536 + b[i + 2] * 256 + b[i + 3];
const le24 = (b, i) => b[i] + b[i + 1] * 256 + b[i + 2] * 65536;
const le32 = (b, i) =>
  b[i] + b[i + 1] * 256 + b[i + 2] * 65536 + b[i + 3] * 16777216;
const invalidFile = () => {
  throw Error(
    "The image file is incomplete or invalid. Choose another PNG, JPEG, WebP or GIF.",
  );
};
function checkPngChunks(bytes) {
  let offset = 8,
    pixels = false,
    ended = false;
  while (offset + 12 <= bytes.length) {
    const size = be32(bytes, offset),
      kind = ascii(bytes, offset + 4, offset + 8),
      end = offset + size + 12;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(kind)) invalidFile();
    if (offset === 8 ? kind !== "IHDR" : kind === "IHDR") invalidFile();
    if (kind === "IDAT" && size > 0) pixels = true;
    if (kind === "IEND") {
      if (size !== 0 || end !== bytes.length) invalidFile();
      ended = true;
      break;
    }
    offset = end;
  }
  if (!pixels || !ended) invalidFile();
}
function checkGifBlocks(bytes) {
  let offset = 13 + (bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0),
    images = 0;
  const subBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++];
      if (!size) return;
      offset += size;
      if (offset > bytes.length) invalidFile();
    }
    invalidFile();
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) {
      if (offset !== bytes.length || !images) invalidFile();
      return;
    }
    if (marker === 0x21) {
      if (offset >= bytes.length) invalidFile();
      offset++;
      subBlocks();
    } else if (marker === 0x2c) {
      if (offset + 9 > bytes.length) invalidFile();
      const w = bytes[offset + 4] + bytes[offset + 5] * 256,
        h = bytes[offset + 6] + bytes[offset + 7] * 256;
      if (!w || !h || w > 10000 || h > 10000 || w * h > MAX_PIXELS)
        invalidFile();
      const packed = bytes[offset + 8];
      offset += 9 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
      if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8)
        invalidFile();
      offset++;
      subBlocks();
      images++;
    } else invalidFile();
  }
  invalidFile();
}
function checkWebpChunks(bytes) {
  if (le32(bytes, 4) + 8 !== bytes.length) invalidFile();
  let offset = 12,
    pixels = false;
  while (offset + 8 <= bytes.length) {
    const kind = ascii(bytes, offset, offset + 4),
      size = le32(bytes, offset + 4);
    offset += 8 + size + (size % 2);
    if (offset > bytes.length) invalidFile();
    if (["VP8 ", "VP8L", "ANMF"].includes(kind) && size > 0) pixels = true;
  }
  if (offset !== bytes.length || !pixels) invalidFile();
}
export function rasterImageInfo(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.length ||
    bytes.length > MAX_IMAGE_BYTES
  )
    throw Error("Choose an image file up to 1 MB.");
  let mime, width, height;
  if (
    bytes.length >= 33 &&
    ascii(bytes, 1, 4) === "PNG" &&
    bytes[0] === 137 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10 &&
    ascii(bytes, 12, 16) === "IHDR" &&
    be32(bytes, 8) === 13
  ) {
    mime = "image/png";
    width = be32(bytes, 16);
    height = be32(bytes, 20);
  } else if (
    bytes.length >= 13 &&
    ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))
  ) {
    mime = "image/gif";
    width = bytes[6] + bytes[7] * 256;
    height = bytes[8] + bytes[9] * 256;
  } else if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    mime = "image/webp";
    const kind = ascii(bytes, 12, 16);
    if (kind === "VP8X" && bytes.length >= 30) {
      width = le24(bytes, 24) + 1;
      height = le24(bytes, 27) + 1;
    } else if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      width = 1 + bytes[21] + ((bytes[22] & 63) << 8);
      height =
        1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10);
    } else if (
      kind === "VP8 " &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 1 &&
      bytes[25] === 0x2a
    ) {
      width = (bytes[26] + bytes[27] * 256) & 0x3fff;
      height = (bytes[28] + bytes[29] * 256) & 0x3fff;
    }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = "image/jpeg";
    let i = 2;
    const frames = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
      0xcf,
    ]);
    while (i + 3 < bytes.length) {
      if (bytes[i++] !== 0xff) break;
      while (bytes[i] === 0xff) i++;
      const marker = bytes[i++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = be16(bytes, i);
      if (length < 2 || i + length > bytes.length) break;
      if (frames.has(marker) && length >= 8) {
        height = be16(bytes, i + 3);
        width = be16(bytes, i + 5);
        break;
      }
      i += length;
    }
  }
  if (mime === "image/png") checkPngChunks(bytes);
  if (mime === "image/gif") checkGifBlocks(bytes);
  if (mime === "image/webp") checkWebpChunks(bytes);
  if (
    mime === "image/jpeg" &&
    (bytes.at(-2) !== 0xff ||
      bytes.at(-1) !== 0xd9 ||
      !bytes.some(
        (value, index) => value === 0xff && bytes[index + 1] === 0xda,
      ))
  )
    invalidFile();
  if (
    !mime ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw Error("Choose a PNG, JPEG, WebP or GIF image.");
  if (width > 10000 || height > 10000 || width * height > MAX_PIXELS)
    throw Error(
      "Choose an image no larger than 10,000 pixels per side and 24 megapixels.",
    );
  return { mime, width, height, bytes: bytes.length };
}
export function imageSourceError(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    /[\u0000-\u0020\u007f\\]/.test(value)
  )
    return "Use an HTTPS image URL, a site image path, or choose an image file.";
  if (value.startsWith("data:")) {
    const match =
      /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
        value,
      );
    if (
      !match ||
      match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      match[2].length % 4 !== 0
    )
      return "Choose a PNG, JPEG, WebP or GIF file up to 1 MB.";
    try {
      const binary = atob(match[2]);
      if (btoa(binary) !== match[2])
        return "The image file encoding is invalid.";
      const info = rasterImageInfo(
        Uint8Array.from(binary, (c) => c.charCodeAt(0)),
      );
      if (info.mime !== match[1])
        return "The image file type does not match its contents.";
      return null;
    } catch (error) {
      return error.message || "The image file is invalid.";
    }
  }
  if (value.length > 8192) return "The image URL is too long.";
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("#"))
    return null;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.hostname &&
      !url.username &&
      !url.password &&
      !url.hash
    )
      return null;
  } catch {}
  return "Use an HTTPS image URL or a site image path.";
}
export const isSafeImageSource = (value) => imageSourceError(value) === null;
export async function rasterFileSource(file) {
  if (
    !file ||
    typeof file.arrayBuffer !== "function" ||
    file.size > MAX_IMAGE_BYTES ||
    file.size < 1
  )
    throw Error("Choose an image file up to 1 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = rasterImageInfo(bytes);
  if (
    typeof createImageBitmap === "function" &&
    typeof Blob === "function" &&
    file instanceof Blob
  ) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw Error(
        "The image could not be opened. Choose another PNG, JPEG, WebP or GIF.",
      );
    } finally {
      bitmap?.close();
    }
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${info.mime};base64,${btoa(binary)}`;
}
