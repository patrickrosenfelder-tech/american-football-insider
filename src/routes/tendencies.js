const express = require('express');
const router = express.Router();
const tendencyService = require('../services/tendencyService');
const { currentSeason } = require('../services/rosterService');

// GET /api/tendencies[?season=2026] — league table: one row per team (season-to-date).
router.get('/', async (req, res) => {
  try {
    const season = Number(req.query.season) || currentSeason();
    const [t, reference] = await Promise.all([tendencyService.getTendencies(season), tendencyService.getReference(season)]);
    if (!t) return res.status(503).json({ success: false, error: `Tendencies for ${season} not built yet (refresh job pending)` });
    const ref = reference && reference.season !== season ? reference : null;
    const rows = Object.entries(t.teams).map(([team, v]) => {
      const o = v.season.offense;
      const d = v.season.defense;
      const rd = ref?.teams[team]?.season.defense.participation;
      const ro = ref?.teams[team]?.season.offense.personnel;
      return {
        team,
        offense: {
          plays: o.plays, pass_rate: o.pass_rate, neutral_pass_rate: o.neutral_pass_rate, shotgun_rate: o.shotgun_rate,
          no_huddle_rate: o.no_huddle_rate, seconds_per_play: o.seconds_per_play, epa_per_play: o.epa_per_play,
          motion_rate: o.ftn?.motion_rate ?? null, play_action_rate: o.ftn?.play_action_rate ?? null,
          personnel_11_rate: o.personnel ? (o.personnel.find((x) => x.key === '11')?.pct ?? 0) : null
        },
        defense: {
          plays: d.plays, epa_per_play_allowed: d.epa_per_play_allowed, blitz_rate: d.ftn?.blitz_rate ?? null,
          avg_pass_rushers: d.ftn?.avg_pass_rushers ?? null, avg_box: d.ftn?.avg_box ?? null,
          man_rate: d.participation?.man_rate ?? null
        },
        reference: ref ? {
          season: ref.season,
          personnel_11_rate: ro?.find((x) => x.key === '11')?.pct ?? null,
          man_rate: rd?.man_rate ?? null,
          top_shell: rd?.coverage_shells?.[0]?.label ?? null,
          nickel_rate: rd?.packages?.find((x) => x.key.startsWith('Nickel'))?.pct ?? null,
          derived_base_front: rd?.derived_base_front ?? null
        } : null
      };
    }).sort((a, b) => a.team.localeCompare(b.team));
    res.json({
      success: true,
      data: {
        season: t.season,
        data_through_week: t.data_through_week,
        sources: t.sources,
        reference_season: ref?.season ?? null,
        league: t.league,
        teams: rows,
        last_updated: t.updated_at
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
