// Stale v2 artifacts must not be served: picks fall back to v1 and /status says so.
jest.mock('../src/db/database', () => ({ loadDataset: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), existsSync: jest.fn(() => true), readFileSync: jest.fn() }));
const fs = require('fs');
const db = require('../src/db/database');
const { predictionStatus } = require('../src/services/picksService');

const artifact = (hoursOld, games = 2) => ({ model_version: 'v2.1.0', generated_at: new Date(Date.now() - hoursOld * 3600e3).toISOString(), predictions: Array(games).fill({ game_id: 'x' }) });

test('fresh disk artifact is served', async () => {
  db.loadDataset.mockResolvedValue(null);
  fs.readFileSync.mockReturnValue(JSON.stringify(artifact(3)));
  const s = await predictionStatus();
  expect(s).toMatchObject({ available: true, stale: false, source: 'disk', games: 2 });
  expect(s.artifact).not.toBeNull();
});

test('newest of DB and disk wins, and >48h is stale', async () => {
  db.loadDataset.mockResolvedValue({ data: artifact(50, 5) });
  fs.readFileSync.mockReturnValue(JSON.stringify(artifact(60)));
  const s = await predictionStatus();
  expect(s).toMatchObject({ available: false, stale: true, source: 'db', games: 5 });
  expect(s.artifact).toBeNull();
});
