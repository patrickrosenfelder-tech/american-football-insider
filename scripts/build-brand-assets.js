#!/usr/bin/env node
// Regenerates the static brand images in client/public:
//   og-image.png (1200x630 share card) and the PWA icons in icons/.
// Run after changing the brand:  node scripts/build-brand-assets.js
const fs = require('fs');
const path = require('path');
const { brandCardSvg, toPng, football } = require('../src/services/shareImage');

const PUBLIC = path.join(__dirname, '../client/public');
fs.mkdirSync(path.join(PUBLIC, 'icons'), { recursive: true });

const icon = (size, { maskable = false } = {}) => {
  // Maskable icons keep the artwork inside the central 80% safe zone on a full-bleed background.
  const art = maskable ? size * 0.72 : size;
  const offset = (size - art) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${maskable ? `<rect width="${size}" height="${size}" fill="#0b1730"/>` : ''}${football(offset, offset, art)}</svg>`;
};

const write = (file, png) => { fs.writeFileSync(path.join(PUBLIC, file), png); console.log(`${file} ${(png.length / 1024).toFixed(1)} KB`); };
write('og-image.png', toPng(brandCardSvg()));
write('icons/icon-192.png', toPng(icon(192)));
write('icons/icon-512.png', toPng(icon(512)));
write('icons/icon-maskable-512.png', toPng(icon(512, { maskable: true })));
write('icons/apple-touch-icon.png', toPng(icon(180, { maskable: true })));
