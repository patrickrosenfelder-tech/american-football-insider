const { blueskySegments, isBreaking } = require('../src/services/socialService');

describe('socialService', () => {
  test('bluesky link facets become segments with the full URL (UTF-8 byte offsets)', () => {
    const text = 'Rashée 🏈 out: nfl.com/news/a...';
    const start = Buffer.byteLength('Rashée 🏈 out: ');
    const facets = [{ index: { byteStart: start, byteEnd: Buffer.byteLength(text) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://nfl.com/news/abc' }] }];
    expect(blueskySegments(text, facets)).toEqual([
      { text: 'Rashée 🏈 out: ' },
      { text: 'nfl.com/news/a...', href: 'https://nfl.com/news/abc' }
    ]);
    expect(blueskySegments(text, [])).toBeNull();
  });

  test('breaking = insider + keyword + under 30 minutes', () => {
    const now = Date.parse('2026-10-09T20:00:00Z');
    const post = (o) => ({ insider: true, text: 'Bears are trading WR to the Jets', published: '2026-10-09T19:45:00Z', ...o });
    expect(isBreaking(post({}), now)).toBe(true);
    expect(isBreaking(post({ text: 'Player placed on IR' }), now)).toBe(true);
    expect(isBreaking(post({ text: 'Great game today' }), now)).toBe(false);
    expect(isBreaking(post({ insider: false }), now)).toBe(false);
    expect(isBreaking(post({ published: '2026-10-09T19:00:00Z' }), now)).toBe(false);
  });
});
