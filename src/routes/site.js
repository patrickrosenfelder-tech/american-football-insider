// Crawler and sharing endpoints served outside the SPA: robots.txt, sitemap.xml and
// generated matchup share cards (/og/game/:id.png, /og/preview/:id.png).
const express = require('express');
const router = express.Router();
const sportsDataService = require('../services/sportsDataService');
const { robotsTxt, sitemapXml } = require('../services/siteRoutes');
const shareImage = require('../services/shareImage');

const SITEMAP_TIMEOUT_MS = 4000;

router.get('/robots.txt', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('text/plain').send(robotsTxt());
});

router.get('/sitemap.xml', async (req, res) => {
  let games = [];
  try {
    // Current regular season from the cached playoff schedule (all 18 weeks).
    const { loadSeason } = require('../services/playoffService');
    const season = await Promise.race([loadSeason(), new Promise((resolve) => setTimeout(resolve, SITEMAP_TIMEOUT_MS).unref?.())]);
    games = (season?.games || []).map((g) => ({ id: g.id, date: g.date, state: g.state }));
  } catch (error) {
    // Static routes and team pages are still listed.
  }
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(sitemapXml(games));
});

router.get('/og/:kind(game|preview)/:gameId(\\d{6,12}).png', async (req, res) => {
  try {
    const game = await sportsDataService.getGameDetail(req.params.gameId);
    if (!game) return res.status(404).type('text/plain').send('Game not found');
    const png = shareImage.matchupCard(game, req.params.kind);
    // Finals never change; scheduled and live cards refresh every few minutes.
    res.set('Cache-Control', game.status?.state === 'post' ? 'public, max-age=86400' : 'public, max-age=300');
    return res.type('image/png').send(png);
  } catch (error) {
    // Upstream failure: fall back to the static brand card rather than a broken image.
    res.set('Cache-Control', 'public, max-age=60');
    return res.redirect(302, '/og-image.png');
  }
});

module.exports = router;
