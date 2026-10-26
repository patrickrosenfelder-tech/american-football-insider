// Shared date formatting. Every date in the UI uses one unambiguous US style
// ("Oct 8, 2026", "Sun, Oct 26, 1:00 PM ET") in US Eastern time, regardless of
// the visitor's browser locale. Keep this file free of imports: tests load it directly.
const ZONE = 'America/New_York';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const toDate = (value) => {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};
// A bare calendar date ("2026-10-08") is a day, not an instant: format it in UTC so it never shifts to the previous day.
const zoneFor = (value) => (typeof value === 'string' && DATE_ONLY.test(value) ? 'UTC' : ZONE);
const fmt = (value, options, fallback) => {
  const d = toDate(value);
  return d ? d.toLocaleString('en-US', { timeZone: zoneFor(value), ...options }) : fallback;
};

// "Oct 8, 2026"
export const formatDate = (value, fallback = '–') => fmt(value, { month: 'short', day: 'numeric', year: 'numeric' }, fallback);
// "Oct 8"
export const formatShortDate = (value, fallback = '–') => fmt(value, { month: 'short', day: 'numeric' }, fallback);
// "Oct 8, 2026, 1:05 PM ET"
export const formatDateTime = (value, fallback = '–') => {
  const text = fmt(value, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }, null);
  return text ? `${text} ET` : fallback;
};
// "Sun, Oct 26, 1:00 PM ET"
export const formatKickoff = (value, fallback = 'TBD') => {
  const text = fmt(value, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, null);
  return text ? `${text} ET` : fallback;
};
// "Sunday, October 26" (scoreboard day headings)
export const formatDayHeading = (value, fallback = '') => fmt(value, { weekday: 'long', month: 'long', day: 'numeric' }, fallback);
