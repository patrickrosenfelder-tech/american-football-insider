// Lightweight server-rendered summaries for key routes. The HTML shell gets a real
// <h1> and the core text (teams, score or kickoff) so crawlers and first paint are
// not empty; React replaces it when the app boots. Data comes from the same cached
// ESPN services as the API, and a slow upstream never blocks the page for long.
const ZONE = 'America/New_York';
const SUMMARY_TIMEOUT_MS = 2500;

// Same output as client/src/dates.js formatKickoff: "Sun, Oct 26, 1:00 PM ET".
const formatKickoff = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return 'TBD';
  return `${d.toLocaleString('en-US', { timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`;
};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const withTimeout = (promise, ms = SUMMARY_TIMEOUT_MS) => Promise.race([
  promise,
  new Promise((resolve) => { setTimeout(() => resolve(undefined), ms).unref?.(); })
]);

const teamName = (t = {}) => t.name || t.short_name || t.abbreviation || 'TBD';
const matchupTitle = (g) => `${teamName(g.away)} at ${teamName(g.home)}`;

const gameLine = (g) => {
  const state = g.status?.state;
  if (state === 'pre') return `${matchupTitle(g)} · ${formatKickoff(g.date)}${g.broadcast ? ` · ${g.broadcast}` : ''}`;
  const score = `${teamName(g.away)} ${g.away?.score ?? '–'}, ${teamName(g.home)} ${g.home?.score ?? '–'}`;
  return `${score} · ${state === 'in' ? `Live, ${g.status.detail || 'in progress'}` : g.status?.detail || 'Final'}`;
};

const gameSummary = (g, kind) => {
  const venue = g.venue?.name ? `${g.venue.name}${g.venue.city ? `, ${g.venue.city}` : ''}` : null;
  const facts = [g.status?.state === 'pre' ? `Kickoff: ${formatKickoff(g.date)}` : gameLine(g), venue, g.broadcast, g.odds ? `Line: ${g.odds}` : null].filter(Boolean);
  const records = [g.away, g.home].filter((t) => t?.record).map((t) => `${teamName(t)} (${t.record})`).join(' · ');
  return `<h1>${esc(matchupTitle(g))}${kind === 'preview' ? ' matchup preview' : ''}</h1>
<p>${facts.map(esc).join(' · ')}</p>${records ? `\n<p class="muted">${esc(records)}</p>` : ''}
<p><a href="/${kind === 'preview' ? 'game' : 'preview'}/${esc(g.game_id)}">${kind === 'preview' ? 'Game center' : 'Matchup preview'}</a></p>`;
};

const homeSummary = (board) => {
  const heading = `${board.season} ${Number(board.season_type) === 3 ? 'Playoffs' : `Week ${board.week}`}`;
  const items = (board.games || []).map((g) => `<li><a href="/${g.status?.state === 'pre' ? 'preview' : 'game'}/${esc(g.game_id)}">${esc(gameLine(g))}</a></li>`).join('\n');
  return `<h1>${esc(heading)}</h1>\n<p class="muted">NFL scores and schedule · All times ET · ${(board.games || []).length} games</p>\n<ul>\n${items}\n</ul>`;
};

const standingsSummary = (s) => {
  const confs = (s.conferences || []).map((c) => `<h2>${esc(c.name)}</h2>\n<ul>\n${(c.divisions || []).map((d) => `<li><b>${esc(d.name)}:</b> ${d.teams.map((t) => `${esc(t.name)} ${esc(`${t.wins}-${t.losses}${Number(t.ties) ? `-${t.ties}` : ''}`)}`).join(', ')}</li>`).join('\n')}\n</ul>`).join('\n');
  return `<h1>${esc(s.season_display || '')} Standings</h1>\n${confs}`;
};

// Returns { status, title?, html?, game? } for a classified route.
// status 404 means the id does not exist upstream (an invalid game id).
const loadSummary = async (route, { kind, id } = {}) => {
  const sports = require('./sportsDataService');
  try {
    if (kind === 'game' || kind === 'preview') {
      const game = await withTimeout(sports.getGameDetail(id));
      if (game === null) return { status: 404 };
      if (!game) return { status: 200 };
      return {
        status: 200,
        game,
        title: kind === 'preview' ? `${matchupTitle(game)} · Preview` : matchupTitle(game),
        description: `${gameLine(game)}. ${kind === 'preview' ? 'Form, injuries, trends, AFI pick and kickoff weather.' : 'Box score, team stats, leaders and scoring plays.'}`,
        html: gameSummary(game, kind)
      };
    }
    if (route === '') {
      const board = await withTimeout(sports.getScoreboard({}));
      return board?.games ? { status: 200, html: homeSummary(board) } : { status: 200 };
    }
    if (route === 'standings') {
      const standings = await withTimeout(sports.getStandings());
      return standings?.conferences ? { status: 200, html: standingsSummary(standings) } : { status: 200 };
    }
  } catch (error) {
    // Upstream errors fall back to the plain shell; the client shows its own error state.
  }
  return { status: 200 };
};

module.exports = { loadSummary, formatKickoff, gameLine, homeSummary, standingsSummary, gameSummary, matchupTitle };
