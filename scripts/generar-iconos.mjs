/**
 * Genera los iconos cuadrados de la PWA y de las notificaciones a partir
 * de public/logo-monograma.png (el isotipo "CP", que es el que se lee en
 * tamaño chico): lo compone sobre fondo blanco, centrado y con margen, y
 * lo redimensiona.
 *
 * Correr desde la raíz del proyecto cuando cambie el logo:
 *   node scripts/generar-iconos.mjs
 *
 * Sin dependencias: decodifica y codifica PNG con zlib.
 */
import fs from "node:fs";
import zlib from "node:zlib";

// ---------- decodificar PNG (8 bits, color type 2 o 6, sin interlace)
function decodePng(buffer) {
  let pos = 8;
  let width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("PNG entrelazado no soportado");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + length;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`PNG no soportado (bitDepth ${bitDepth}, colorType ${colorType})`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.from(line);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) cur[i] = (cur[i] + a) & 0xff;
      else if (filter === 2) cur[i] = (cur[i] + b) & 0xff;
      else if (filter === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

// ---------- codificar PNG RGB
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- icono: logo centrado sobre blanco, con margen
function makeIcon(logo, size, marginRatio = 0.12) {
  const box = Math.round(size * (1 - marginRatio * 2));
  const scale = Math.min(box / logo.width, box / logo.height);
  const drawW = Math.round(logo.width * scale);
  const drawH = Math.round(logo.height * scale);
  const offX = Math.round((size - drawW) / 2);
  const offY = Math.round((size - drawH) / 2);
  const out = Buffer.alloc(size * size * 3, 0xff); // fondo blanco

  for (let y = 0; y < drawH; y++) {
    for (let x = 0; x < drawW; x++) {
      // Muestreo bilineal del logo original.
      const sx = Math.min(logo.width - 1, (x + 0.5) / scale - 0.5);
      const sy = Math.min(logo.height - 1, (y + 0.5) / scale - 0.5);
      const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy));
      const x1 = Math.min(logo.width - 1, x0 + 1), y1 = Math.min(logo.height - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      let r = 0, g = 0, b = 0, a = 0;
      for (const [px, py, w] of [
        [x0, y0, (1 - fx) * (1 - fy)],
        [x1, y0, fx * (1 - fy)],
        [x0, y1, (1 - fx) * fy],
        [x1, y1, fx * fy],
      ]) {
        const i = (py * logo.width + px) * logo.channels;
        const alpha = logo.channels === 4 ? logo.data[i + 3] / 255 : 1;
        r += logo.data[i] * alpha * w;
        g += logo.data[i + 1] * alpha * w;
        b += logo.data[i + 2] * alpha * w;
        a += alpha * w;
      }
      const o = ((offY + y) * size + (offX + x)) * 3;
      // Composición sobre blanco.
      out[o] = Math.round(r + 255 * (1 - a));
      out[o + 1] = Math.round(g + 255 * (1 - a));
      out[o + 2] = Math.round(b + 255 * (1 - a));
    }
  }
  return encodePng(size, size, out);
}

const logo = decodePng(fs.readFileSync("public/logo-monograma.png"));
console.log(`monograma: ${logo.width}x${logo.height}, ${logo.channels} canales`);
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  fs.writeFileSync(`public/${name}`, makeIcon(logo, size, 0.14));
  console.log("generado public/" + name, size + "px");
}
