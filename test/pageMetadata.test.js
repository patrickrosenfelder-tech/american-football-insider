const { renderMetadata } = require('../src/services/pageMetadata');
const template = '<head><meta name="description" content="Generic" /><title>Generic</title></head><body>App</body>';
test('initial team HTML contains a descriptive title, canonical and sharing metadata', () => {
  const html = renderMetadata(template, '/teams/BUF');
  expect(html).toContain('<title>Buffalo Bills | AFI</title>');
  expect(html).toContain('Buffalo Bills: schedule, roster, injuries');
  expect(html).toContain('property="og:title" content="Buffalo Bills | AFI"');
  expect(html).toContain('name="twitter:card" content="summary"');
  expect(html).toContain('rel="canonical" href="https://american-football-insider.fly.dev/teams/BUF"');
});
test('route descriptions differ and arbitrary paths are HTML-escaped', () => {
  expect(renderMetadata(template, '/picks')).toContain('AFI model spread, total and moneyline');
  expect(renderMetadata(template, '/status')).toContain('Refresh health');
  expect(renderMetadata(template, '/"><script>alert(1)</script>')).not.toContain('<script>alert(1)</script>');
});
