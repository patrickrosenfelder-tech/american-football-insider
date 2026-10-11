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
test('preserves the approved scoreboard, week picker and filters', () => expect(hash(scores)).toBe('84c339592f0c6a3520ff2141acade879a130d206cc2789908c5eb75cfc6f5372'));
test('preserves the approved score card and postgame links', () => expect(hash(card)).toBe('a69870d01d9d1a1c9d7af56b9199ad223b12e66359fb31b9e2e1471059295450'));
