// Guard the production design recovered from f96f868. Update only after reviewing visual changes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const css = read('client/src/styles.css').split('/* Audit accessibility fixes;')[0].trim();
const scores = read('client/src/pages/Scores.jsx');
const components = read('client/src/components.jsx');
const card = components.slice(components.indexOf('export function GameCard('), components.indexOf('export function FeaturedFinal('));
test('preserves the approved light-theme stylesheet', () => expect(hash(css)).toBe('7940e1d04ad576cd08732b9e86c2a1e9825b454b60a3e4895e90c82af416cf51'));
// Reviewed 2026-10-26: loading state uses a same-size card skeleton (CLS) and the first cards load logos eagerly; layout unchanged.
test('preserves the approved scoreboard, week picker and filters', () => expect(hash(scores)).toBe('5d66b5d6ed6e57a35fd4e80597faf3bd61534a62df2f6874325bf7830af05eb9'));
// Reviewed 2026-10-26: Injuries/News links filter to the two teams of the game; eager logo prop. Visual layout unchanged.
test('preserves the approved score card and postgame links', () => expect(hash(card)).toBe('ba33d73be364339e51b710a8c49909fbf07c587086f2d2195387aee7a2388179'));
