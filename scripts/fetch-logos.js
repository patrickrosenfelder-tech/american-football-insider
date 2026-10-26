#!/usr/bin/env node
// One-off: download ESPN's 500 px team logos once and write small local copies
// (96 px and 192 px, PNG + WebP) to client/public/logos. The UI displays logos
// at 16-84 px, so the 500 px originals (up to ~570 KB each) are never needed.
// Re-run only when a team rebrands:  node scripts/fetch-logos.js
// Logos are served with a one-year cache, so a changed logo needs a new file name.
// Requires `cwebp` (brew install webp / apt install webp) for the WebP copies.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const axios = require('axios');
const { Resvg } = require('@resvg/resvg-js');

const OUT = path.join(__dirname, '../client/public/logos');
const SIZES = [96, 192];
const TEAMS = ['ari', 'atl', 'bal', 'buf', 'car', 'chi', 'cin', 'cle', 'dal', 'den', 'det', 'gb', 'hou', 'ind', 'jax', 'kc', 'lac', 'lar', 'lv', 'mia', 'min', 'ne', 'no', 'nyg', 'nyj', 'phi', 'pit', 'sea', 'sf', 'tb', 'ten', 'wsh'];

const resize = (png, size) => new Resvg(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><image width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${png.toString('base64')}"/></svg>`
).render().asPng();

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const team of TEAMS) {
    const { data } = await axios.get(`https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/${team}.png`, { responseType: 'arraybuffer', timeout: 20000 });
    for (const size of SIZES) {
      const file = path.join(OUT, `${team}-${size}`);
      fs.writeFileSync(`${file}.png`, resize(Buffer.from(data), size));
      execFileSync('cwebp', ['-quiet', '-q', '85', '-alpha_q', '90', '-m', '6', `${file}.png`, '-o', `${file}.webp`]);
    }
    console.log(team);
  }
})().catch((error) => { console.error(error.message); process.exit(1); });
