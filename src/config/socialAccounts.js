// Social feed sources. Edit this file to add or remove accounts; no other change is needed.
//
// Bluesky: `handle` as shown on bsky.app. `insider: true` marks national insiders/news accounts whose
//   posts can be flagged "Breaking" (keyword match within 30 min). `team` (ESPN abbreviation) tags every
//   post from a beat reporter with that team, on top of the text-based team tagging.
//   `enabled: false` keeps an account listed but skips it.
// YouTube: `channel_id` (UC...) from the channel page; the public RSS feed needs no API key.
// Reddit: needs REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET (see README "Reddit setup"); disabled without them.
//
// Activity verified 2026-10-09 (posts in the previous 7 days unless noted).

const bluesky = [
  // National insiders and breaking-news accounts
  { handle: 'rapsheet.bsky.social', name: 'Ian Rapoport', insider: true },
  { handle: 'nflnewsposter.bsky.social', name: 'NFL News Poster', insider: true },
  { handle: 'nfltraderumors.bsky.social', name: 'NFL Trade Rumors', insider: true },
  { handle: 'insidenflnews.bsky.social', name: 'NFL Daily News', insider: true },
  { handle: 'mattlombardo.bsky.social', name: 'Matt Lombardo', insider: true },
  { handle: 'garrettpodell.bsky.social', name: 'Garrett Podell', insider: true },
  { handle: 'ralphvacchiano.bsky.social', name: 'Ralph Vacchiano', insider: true },
  // Last post Nov 2024; kept so it resumes automatically if he returns.
  { handle: 'adamschefter.bsky.social', name: 'Adam Schefter', insider: true, enabled: false },
  // National writers and analysts
  { handle: 'jourdanrodrigue.bsky.social', name: 'Jourdan Rodrigue' },
  { handle: 'mikesilver.bsky.social', name: 'Mike Silver' },
  { handle: 'greggrosenthal.bsky.social', name: 'Gregg Rosenthal' },
  { handle: 'minakimes.bsky.social', name: 'Mina Kimes' },
  { handle: 'sheilkapadia.bsky.social', name: 'Sheil Kapadia' },
  { handle: 'aaronschatz.com', name: 'Aaron Schatz' },
  // Team beat reporters
  { handle: 'seanhammond.bsky.social', name: 'Sean Hammond', team: 'CHI' },
  { handle: 'giana-jade.bsky.social', name: 'Giana Han', team: 'BAL' },
  { handle: 'detroitfootball.net', name: 'Justin Rogers', team: 'DET' },
  { handle: 'antwanstaley.bsky.social', name: 'Antwan Staley', team: 'NYJ' },
  { handle: 'saadyousuf126.bsky.social', name: 'Saad Yousuf', team: 'DAL' },
  { handle: 'parkerjgabriel.bsky.social', name: 'Parker Gabriel', team: 'DEN' },
  { handle: 'joebuscaglia.bsky.social', name: 'Joe Buscaglia', team: 'BUF' },
  { handle: 'ashleybastock42.bsky.social', name: 'Ashley Bastock', team: 'CLE' }
];

const youtube = [
  { channel_id: 'UCDVYQ4Zhbm3S2dlz7P1GBDg', name: 'NFL' },
  { channel_id: 'UC_1H9v258pXiyLDaW0R5exw', name: 'NFL Network' },
  { channel_id: 'UCiio0ydw439X13KyZgMIcHw', name: 'NFL on ESPN' },
  { channel_id: 'UC7ZUfHFsuQcW7BkTHnXJtqw', name: 'NFL on CBS' },
  { channel_id: 'UCvQrivswRDGK0lZ_AcUHp8g', name: 'NFL on FOX' },
  { channel_id: 'UCxcTeAKWJca6XyJ37_ZoKIQ', name: 'The Pat McAfee Show' },
  { channel_id: 'UCY-IDqcyz8tev_jmRboQRsg', name: 'PFF' },
  { channel_id: 'UCYIU0Kg5Lzziasl94RepyZw', name: 'Ringer NFL' },
  { channel_id: 'UCOTPo2y-NHJjg1EuENrxypA', name: 'First Things First' },
  { channel_id: 'UCYzfVBuCfGz-oF3aOCGgO5g', name: 'Brett Kollmann' }
];

const reddit = [
  { subreddit: 'nfl', listing: 'hot', limit: 30 }
];

module.exports = { bluesky, youtube, reddit };
