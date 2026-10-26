// client/src/dates.js is an ES module without imports; load it into a sandbox for Jest.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../client/src/dates.js'), 'utf8').replace(/^export /gm, '');
const sandbox = {};
vm.runInNewContext(`${source}\nObject.assign(globalThis.out, { formatDate, formatShortDate, formatDateTime, formatKickoff, formatDayHeading });`, { out: sandbox, Date, Number });
const { formatDate, formatShortDate, formatDateTime, formatKickoff, formatDayHeading } = sandbox;

test('dates use one unambiguous US style in US Eastern time', () => {
  expect(formatDate('2026-10-25T18:00:00Z')).toBe('Oct 25, 2026');
  expect(formatShortDate('2026-10-08T15:00:00Z')).toBe('Oct 8');
  expect(formatDateTime('2026-10-25T17:05:00Z')).toBe('Oct 25, 2026, 1:05 PM ET');
  expect(formatKickoff('2026-10-26T00:20:00Z')).toBe('Sun, Oct 25, 8:20 PM ET');
  expect(formatDayHeading('2026-10-25T17:00:00Z')).toBe('Sunday, October 25');
});

test('bare calendar dates never shift to the previous day', () => {
  expect(formatDate('2026-10-08')).toBe('Oct 8, 2026');
  expect(formatShortDate('2026-01-01')).toBe('Jan 1');
});

test('day/month order never depends on the browser locale (no 25/10/2026 or 10/25/2026)', () => {
  for (const value of ['2026-10-25T18:00:00Z', '2026-10-08']) {
    expect(formatDate(value)).not.toMatch(/\d+\/\d+/);
  }
});

test('missing or invalid input uses the fallback', () => {
  expect(formatDate(null)).toBe('–');
  expect(formatDate('not a date')).toBe('–');
  expect(formatDateTime(undefined)).toBe('–');
  expect(formatKickoff('')).toBe('TBD');
});
