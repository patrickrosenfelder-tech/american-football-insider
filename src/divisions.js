// ESPN's team list endpoint omits conference/division, so they're mapped
// statically here (keyed by ESPN abbreviation). NFL alignment is stable.
const DIVISIONS = {
  'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'],
  'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
  'AFC South': ['HOU', 'IND', 'JAX', 'TEN'],
  'AFC West': ['DEN', 'KC', 'LAC', 'LV'],
  'NFC East': ['DAL', 'NYG', 'PHI', 'WSH'],
  'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
  'NFC South': ['ATL', 'CAR', 'NO', 'TB'],
  'NFC West': ['ARI', 'LAR', 'SF', 'SEA'],
};

const byAbbreviation = {};
for (const [division, teams] of Object.entries(DIVISIONS)) {
  for (const abbr of teams) {
    byAbbreviation[abbr] = { conference: division.split(' ')[0], division };
  }
}

function lookup(abbreviation) {
  return byAbbreviation[abbreviation] || { conference: null, division: null };
}

module.exports = { lookup, DIVISIONS };
