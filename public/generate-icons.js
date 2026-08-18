import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const sourcePath = process.argv[2] || 'public/app-mark.png';
const publicDir = 'public';
const iconsDir = path.join(publicDir, 'icons');
const electronAssetsDir = path.join('electron', 'assets');
const pwaSizes = [72, 96, 128, 144, 152, 192, 384, 512];
const logoSizes = [32, 64, 128, 256, 512];
const icoSizes = [16, 32, 48, 64, 128, 256];

const source = await fs.readFile(sourcePath);

async function renderPng(size) {
  const innerSize = Math.round(size * 0.78);
  const outerPadding = size - innerSize;

  return sharp(source)
    .resize(innerSize, innerSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extend({
      top: Math.floor(outerPadding / 2),
      bottom: Math.ceil(outerPadding / 2),
      left: Math.floor(outerPadding / 2),
      right: Math.ceil(outerPadding / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

function createIco(entries) {
  const headerSize = 6 + entries.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = headerSize;
  entries.forEach(({ size, png }, index) => {
    const entryOffset = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entryOffset);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(png.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...entries.map(({ png }) => png)]);
}

await fs.mkdir(iconsDir, { recursive: true });
await fs.mkdir(electronAssetsDir, { recursive: true });
await fs.writeFile(path.join(publicDir, 'app-icon.png'), await renderPng(1024));
await fs.writeFile(path.join(publicDir, 'favicon.png'), await renderPng(64));

await Promise.all(pwaSizes.map(async (size) => {
  await fs.writeFile(path.join(iconsDir, `icon-${size}x${size}.png`), await renderPng(size));
}));

await Promise.all(logoSizes.map(async (size) => {
  await fs.writeFile(path.join(publicDir, `logo-${size}.png`), await renderPng(size));
}));

const icoEntries = await Promise.all(icoSizes.map(async (size) => ({
  size,
  png: await renderPng(size),
})));
await fs.writeFile(
  path.join(electronAssetsDir, 'logo-windows.ico'),
  createIco(icoEntries),
);

console.log(`Generated project icons from ${sourcePath}`);
