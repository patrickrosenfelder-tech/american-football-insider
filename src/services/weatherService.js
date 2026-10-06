const axios = require('axios');
const cache = require('../cache/cacheManager');
const { getScoreboard, getUpcomingScoreboard, getGameDetail } = require('./sportsDataService');

// Kickoff weather from Open-Meteo (free, no key; non-commercial terms) for every game of a week.
// Stadium coordinates + roof type below; venues not in the list (renamed / international) are geocoded
// by city with Open-Meteo's geocoding API and treated as outdoor unless ESPN marks them indoor.

const ROOF = { outdoor: 'Outdoor', dome: 'Dome', retractable: 'Retractable roof', covered: 'Covered (fixed translucent roof)' };

// [venue name (ESPN), lat, lon, roof]
const STADIUMS = [
  ['State Farm Stadium', 33.5276, -112.2626, 'retractable'],
  ['Mercedes-Benz Stadium', 33.7554, -84.4008, 'retractable'],
  ['M&T Bank Stadium', 39.2780, -76.6227, 'outdoor'],
  ['Highmark Stadium', 42.7738, -78.7870, 'outdoor'],
  ['Bank of America Stadium', 35.2258, -80.8528, 'outdoor'],
  ['Soldier Field', 41.8623, -87.6167, 'outdoor'],
  ['Paycor Stadium', 39.0954, -84.5160, 'outdoor'],
  ['Huntington Bank Field', 41.5061, -81.6995, 'outdoor'],
  ['AT&T Stadium', 32.7473, -97.0945, 'retractable'],
  ['Empower Field at Mile High', 39.7439, -105.0201, 'outdoor'],
  ['Ford Field', 42.3400, -83.0456, 'dome'],
  ['Lambeau Field', 44.5013, -88.0622, 'outdoor'],
  ['NRG Stadium', 29.6847, -95.4107, 'retractable'],
  ['Lucas Oil Stadium', 39.7601, -86.1639, 'retractable'],
  ['EverBank Stadium', 30.3239, -81.6373, 'outdoor'],
  ['Arrowhead Stadium', 39.0489, -94.4839, 'outdoor'],
  ['GEHA Field at Arrowhead Stadium', 39.0489, -94.4839, 'outdoor'],
  ['Allegiant Stadium', 36.0909, -115.1833, 'dome'],
  ['SoFi Stadium', 33.9535, -118.3392, 'covered'],
  ['Hard Rock Stadium', 25.9580, -80.2389, 'outdoor'],
  ['U.S. Bank Stadium', 44.9736, -93.2575, 'dome'],
  ['Gillette Stadium', 42.0909, -71.2643, 'outdoor'],
  ['Caesars Superdome', 29.9511, -90.0812, 'dome'],
  ['MetLife Stadium', 40.8135, -74.0745, 'outdoor'],
  ['Lincoln Financial Field', 39.9008, -75.1675, 'outdoor'],
  ['Acrisure Stadium', 40.4468, -80.0158, 'outdoor'],
  ["Levi's Stadium", 37.4030, -121.9700, 'outdoor'],
  ['Lumen Field', 47.5952, -122.3316, 'outdoor'],
  ['Raymond James Stadium', 27.9759, -82.5033, 'outdoor'],
  ['Nissan Stadium', 36.1665, -86.7713, 'outdoor'],
  ['Northwest Stadium', 38.9077, -76.8645, 'outdoor'],
  // International / neutral sites
  ['Wembley Stadium', 51.5560, -0.2796, 'outdoor'],
  ['Tottenham Hotspur Stadium', 51.6043, -0.0664, 'outdoor'],
  ['Melbourne Cricket Ground', -37.8200, 144.9834, 'outdoor'],
  ['Maracanã Stadium', -22.9122, -43.2302, 'outdoor'],
  ['Stade de France', 48.9245, 2.3602, 'outdoor'],
  ['Santiago Bernabéu', 40.4531, -3.6883, 'retractable'],
  ['FC Bayern Munich Stadium', 48.2188, 11.6247, 'covered'],
  ['Allianz Arena', 48.2188, 11.6247, 'covered'],
  ['Estadio Banorte', 19.3029, -99.1505, 'outdoor']
];
const BY_NAME = Object.fromEntries(STADIUMS.map(([name, lat, lon, roof]) => [name.toLowerCase(), { lat, lon, roof }]));

const http = axios.create({ timeout: 12000 });

const geocode = (city, country) => cache.getOrSet(`geo_${city}_${country}`, async () => {
  const { data } = await http.get('https://geocoding-api.open-meteo.com/v1/search', { params: { name: city, count: 5, language: 'en' } });
  const hit = (data.results || []).find((r) => !country || [r.country, r.country_code].some((c) => c && country.toLowerCase().includes(c.toLowerCase()))) || data.results?.[0];
  return hit ? { lat: hit.latitude, lon: hit.longitude } : null;
}, 30 * 24 * 3600);

const locate = async (venue) => {
  if (!venue) return null;
  const known = BY_NAME[(venue.name || '').toLowerCase()];
  if (known) return { ...known, source: 'stadium list' };
  if (!venue.city) return null;
  const geo = await geocode(venue.city, venue.country || venue.state);
  return geo ? { ...geo, roof: venue.indoor ? 'dome' : 'outdoor', source: 'geocoded city' } : null;
};

const HOURLY = 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,snowfall,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code';

const forecast = (lat, lon) => cache.getOrSet(`wx_${lat.toFixed(2)}_${lon.toFixed(2)}`, async () => {
  const { data } = await http.get('https://api.open-meteo.com/v1/forecast', {
    params: { latitude: lat, longitude: lon, hourly: HOURLY, temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch', timezone: 'UTC', forecast_days: 16 }
  });
  return { hourly: data.hourly, fetched_at: new Date().toISOString() };
}, 3600);

const WMO = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail'
};
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// Weather impact flags: wind > 15 mph (or gusts > 30), heavy rain/snow, extreme cold (<= 25F) or heat (>= 90F).
const assess = (w, roof) => {
  if (roof === 'dome' || roof === 'covered') return { level: 'none', flags: [], note: 'Played indoors — no weather impact.' };
  const flags = [];
  if (w.wind_mph > 15 || w.gusts_mph > 30) flags.push({ key: 'wind', label: `Wind ${Math.round(w.wind_mph)} mph${w.gusts_mph > 25 ? `, gusts ${Math.round(w.gusts_mph)}` : ''}`, severity: w.wind_mph >= 20 ? 2 : 1 });
  const likely = w.precip_prob >= 40;
  if (w.snow_in > 0.05 || (likely && [71, 73, 75, 85, 86].includes(w.code))) flags.push({ key: 'snow', label: 'Snow', severity: w.snow_in >= 0.3 ? 2 : 1 });
  else if ((w.precip_prob >= 50 && w.precip_in >= 0.1) || (likely && [65, 82, 95, 96, 99].includes(w.code))) flags.push({ key: 'rain', label: 'Heavy rain', severity: w.precip_in >= 0.25 ? 2 : 1 });
  else if (w.precip_prob >= 60) flags.push({ key: 'rain', label: 'Rain likely', severity: 0 });
  if (w.temp_f <= 25) flags.push({ key: 'cold', label: `Extreme cold (${Math.round(w.temp_f)}°F)`, severity: w.temp_f <= 10 ? 2 : 1 });
  if (w.temp_f >= 90) flags.push({ key: 'heat', label: `Heat (${Math.round(w.temp_f)}°F)`, severity: 1 });
  const score = flags.reduce((s, f) => s + f.severity, 0);
  const level = score >= 3 ? 'high' : score >= 1 ? 'medium' : flags.length ? 'low' : 'none';
  const totalsLean = flags.some((f) => ['wind', 'snow'].includes(f.key) && f.severity >= 1) || flags.some((f) => f.key === 'rain' && f.severity >= 1);
  let note = level === 'none' ? 'No significant weather impact expected.' : `${flags.map((f) => f.label).join(', ')}.`;
  if (totalsLean) note += ' Conditions like these historically favor the run game and lower scoring (lean Under).';
  if (roof === 'retractable') note = `Retractable roof — likely closed if conditions are poor. ${level === 'none' ? '' : `Outside: ${note}`}`.trim();
  return { level: roof === 'retractable' && level !== 'none' ? 'low' : level, flags, note, totals_lean: totalsLean && roof !== 'retractable' ? 'under' : null };
};

const gameWeather = async (g) => {
  const venue = g.venue ? { name: g.venue.name, city: g.venue.city, state: g.venue.state, country: g.venue.country, indoor: g.venue.indoor } : null;
  const base = {
    game_id: g.game_id, date: g.date, week: g.week, state: g.status.state, short_name: g.short_name,
    away: { id: g.away.id, abbreviation: g.away.abbreviation, name: g.away.name, logo: g.away.logo },
    home: { id: g.home.id, abbreviation: g.home.abbreviation, name: g.home.name, logo: g.home.logo },
    venue: venue ? { name: venue.name, city: venue.city } : null,
    lines: g.lines || null
  };
  const loc = await locate(venue).catch(() => null);
  if (!loc) return { ...base, roof: null, forecast: null, impact: null, error: 'Venue location unknown' };
  const result = { ...base, roof: loc.roof, roof_label: ROOF[loc.roof], location_source: loc.source };
  if (g.status.state === 'post') return { ...result, forecast: null, impact: null, note: 'Game completed.' };
  const kickoff = Date.parse(g.date);
  if (kickoff - Date.now() > 15.5 * 24 * 3600e3) return { ...result, forecast: null, impact: null, note: 'Forecast available within 16 days of kickoff.' };
  const fc = await forecast(loc.lat, loc.lon);
  const times = fc.hourly.time.map((t) => Date.parse(`${t}Z`));
  let i = 0;
  times.forEach((t, k) => { if (Math.abs(t - kickoff) < Math.abs(times[i] - kickoff)) i = k; });
  const h = fc.hourly;
  const w = {
    time: new Date(times[i]).toISOString(),
    temp_f: h.temperature_2m[i], feels_like_f: h.apparent_temperature[i],
    precip_prob: h.precipitation_probability[i] ?? 0, precip_in: h.precipitation[i] ?? 0, snow_in: (h.snowfall[i] ?? 0) / 2.54,
    wind_mph: h.wind_speed_10m[i], gusts_mph: h.wind_gusts_10m[i], wind_dir_deg: h.wind_direction_10m[i],
    wind_dir: COMPASS[Math.round((h.wind_direction_10m[i] || 0) / 22.5) % 16], code: h.weather_code[i], conditions: WMO[h.weather_code[i]] || null
  };
  return { ...result, forecast: w, impact: assess(w, loc.roof), forecast_fetched_at: fc.fetched_at };
};

const getWeekWeather = async ({ week, season, seasonType } = {}) => {
  const board = week ? await getScoreboard({ week, season, seasonType }) : await getUpcomingScoreboard();
  const games = await Promise.all(board.games.map((g) => gameWeather(g).catch((error) => ({ game_id: g.game_id, error: error.message }))));
  return { season: board.season, season_type: board.season_type, week: board.week, calendar: board.calendar, games, last_updated: new Date().toISOString() };
};

const getGameWeather = async (gameId) => {
  const detail = await getGameDetail(gameId);
  if (!detail) return null;
  const g = detail.game || detail;
  return gameWeather(g);
};

module.exports = { getWeekWeather, getGameWeather, gameWeather, assess, STADIUMS };
