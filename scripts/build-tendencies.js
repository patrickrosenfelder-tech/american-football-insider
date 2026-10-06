// Builds a static tendencies reference file for a completed season:
//   node scripts/build-tendencies.js 2025   ->  src/data/tendencies_2025.json
// Used for personnel / man-zone / coverage-shell data, which nflverse only publishes after a season.
const fs = require('fs');
const { buildTendencies, referencePath } = require('../src/services/tendencyService');

(async () => {
  const season = Number(process.argv[2]);
  if (!season) throw new Error('Usage: node scripts/build-tendencies.js <season>');
  const result = await buildTendencies(season);
  if (!result.sources.participation) console.warn(`No participation file for ${season}; personnel/coverage will be empty.`);
  const out = { ...result, updated_at: new Date().toISOString() };
  fs.writeFileSync(referencePath(season), JSON.stringify(out));
  console.log(`Wrote ${referencePath(season)}: ${Object.keys(result.teams).length} teams, through week ${result.data_through_week}`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
