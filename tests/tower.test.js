/**
 * Lobster Tower: every LobsterBoard widget has a place in the tower, the art it needs exists,
 * live widget data turns into the right avatar states, and settings are saved safely.
 *
 * The widget list comes from the installed `lobsterboard` package (npm i -D lobsterboard@latest),
 * so CI against the newest release flags any new widget that still needs a room.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const root = process.cwd();
const read = f => readFileSync(join(root, f), 'utf8');
const LB = process.env.LOBSTERBOARD_DIR || join(root, 'node_modules/lobsterboard');

// LobsterBoard's widgets, loaded the way its app.html loads them
function appWidgets() {
  const dom = new JSDOM('<body></body>', { runScripts: 'dangerously' });
  const dir = join(LB, 'js/widgets');
  const files = ['shared/helpers.js', 'shared/icons.js', 'index.js',
    ...readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'index.js')];
  for (const f of files) dom.window.eval(readFileSync(join(dir, f), 'utf8'));
  return dom.window.WIDGETS;
}

function tower(fetchImpl) {
  const dom = new JSDOM('<body></body>', { runScripts: 'dangerously', url: 'http://localhost/' });
  if (fetchImpl) dom.window.fetch = fetchImpl;
  dom.window.eval(read('js/catalog.js'));
  dom.window.eval(read('js/live.js'));
  return dom.window;
}

const json = body => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const routes = table => url => {
  const hit = Object.keys(table).find(k => url.includes(k));
  if (!hit) return Promise.reject(new Error('unexpected fetch ' + url));
  return json(typeof table[hit] === 'function' ? table[hit](url) : table[hit]);
};

describe('tower catalog', () => {
  const W = appWidgets();
  const { TOWER_CATALOG: CAT, TOWER_ROOMS: ROOMS, TOWER_NONE: NONE } = tower();

  it('gives every widget type a place in the tower, or lists it as left out', () => {
    const missing = Object.keys(W).filter(t => !CAT[t] && !NONE.includes(t));
    expect(missing, 'new LobsterBoard widgets: add them to js/catalog.js (TOWER_CATALOG or TOWER_NONE)').toEqual([]);
  });

  // Widgets merged into LobsterBoard but not in a published release yet.
  const NOT_YET_RELEASED = ['media-youtarr'];

  it('only lists real widget types', () => {
    expect(Object.keys(CAT).filter(t => !W[t] && !NOT_YET_RELEASED.includes(t))).toEqual([]);
    expect(NONE.filter(t => !W[t])).toEqual([]);
    expect(Object.keys(CAT).filter(t => NONE.includes(t))).toEqual([]);
  });

  it('puts every entry in a room that exists', () => {
    for (const [type, c] of Object.entries(CAT)) {
      expect(c.room === 'roof' || ROOMS[c.room], `${type} → ${c.room}`).toBeTruthy();
      expect(c.label, `${type} label`).toBeTruthy();
    }
  });

  it('has the art for every room and every character', () => {
    for (const [key, R] of Object.entries(ROOMS)) {
      if (R.art) expect(existsSync(join(root, `assets/room-${R.art}.webp`)), `room art for ${key}`).toBe(true);
    }
    const poses = ['working', 'sitting', 'sleeping', 'gym', 'alert', 'coffee'];
    for (const [type, c] of Object.entries(CAT)) {
      if (!c.cast) continue;
      for (const p of poses) expect(existsSync(join(root, `assets/cast/${c.cast}-${p}.webp`)), `${type}: ${c.cast}-${p}`).toBe(true);
      if (c.walk) for (let i = 0; i < 6; i++) expect(existsSync(join(root, `assets/cast/${c.cast}-walk-${i}.webp`)), `${type}: walk ${i}`).toBe(true);
    }
  });

  it('puts widgets it does not know yet in New Arrivals, and leaves the dropped ones out', () => {
    const win = tower();
    const e = win.towerEntryFor({ id: 'w9', type: 'brand-new-widget', properties: { title: 'Fancy Gauge' } });
    expect(e).toMatchObject({ room: 'arrivals', label: 'Fancy Gauge', avatar: true });
    expect(win.towerEntryFor({ type: 'some-thing' }).label).toBe('Some Thing');
    expect(win.towerEntryFor({ type: 'horizontal-line' })).toBeNull();
    expect(win.towerEntryFor({ type: 'media-plex' }).room).toBe('cinema');
    expect(ROOMS.arrivals).toBeTruthy();
  });
});

describe('tower settings (api.cjs)', () => {
  const api = require('../api.cjs');
  const store = () => { const files = {}; return { files, readData: f => { if (!(f in files)) throw new Error('ENOENT'); return files[f]; }, writeData: (f, o) => { files[f] = o; } }; };

  it('starts with defaults, then saves and returns cleaned settings', () => {
    const ctx = store(), { routes } = api(ctx);
    expect(routes['GET /settings']()).toEqual({ sleepHours: 2, hidden: [] });
    const saved = routes['POST /settings']({}, {}, { body: { sleepHours: 999, hidden: ['gallery', '../etc', 7, 'gallery'] } });
    expect(saved).toEqual({ sleepHours: 48, hidden: ['gallery'] });
    expect(ctx.files['settings.json']).toEqual(saved);
    expect(routes['GET /settings']()).toEqual(saved);
  });
});

describe('tower live states', () => {
  const run = async (type, table, properties = {}) => {
    const win = tower(routes(table));
    return win.TowerLive.ADAPTERS[type]({ id: 'w1', type, properties });
  };

  it('SABnzbd: downloading is working, an empty queue is a break, a repair is housekeeping', async () => {
    const sab = stats => ({ '/api/media/sabnzbd': { ok: true, health: [], stats } });
    expect((await run('media-sabnzbd', sab({ speedBps: 4e6, queue: 3, status: 'Downloading' }))).state).toBe('working');
    expect((await run('media-sabnzbd', sab({ speedBps: 0, queue: 0, status: 'Idle' }))).state).toBe('idle');
    expect((await run('media-sabnzbd', sab({ speedBps: 0, queue: 1, status: 'Repairing' }))).state).toBe('gym');
  });

  it('media: a health error is an alert; a widget not set up yet is not an alert', async () => {
    expect((await run('media-radarr', { '/api/media/radarr': { ok: true, health: [{ level: 'error', message: 'Disk gone' }], stats: { queue: 2 } } })))
      .toMatchObject({ state: 'alert', read: 'Disk gone' });
    expect((await run('media-plex', { '/api/media/plex': { ok: false, code: 'no_url', error: 'Set the server URL' } })).state).toBe('idle');
    expect((await run('media-plex', { '/api/media/plex': { ok: false, code: 'unreachable', error: 'Connection refused' } })).state).toBe('alert');
    expect((await run('media-plex', { '/api/media/plex': { ok: true, health: [], stats: { streams: 2, transcoding: 1 } } })).state).toBe('working');
  });

  it('system: a nearly full disk is an alert, a busy CPU is working', async () => {
    expect((await run('disk-usage', { '/api/stats': { disk: [{ use: 40 }, { use: 93 }] } })).state).toBe('alert');
    expect((await run('cpu-memory', { '/api/stats': { cpu: { currentLoad: 42 }, memory: { active: 4, total: 8 } } })))
      .toMatchObject({ state: 'working', read: 'CPU 42% · RAM 50%' });
    expect((await run('cpu-memory', { '/api/stats': {} }, { server: 'nas' })).read).toContain('Remote server');
  });

  it('LobsterBoard release: an update waiting makes Mr. Claws panic', async () => {
    expect((await run('lobsterboard-release', { '/api/lb-release': { current: '0.9.1', latest: 'v0.9.2' } })).state).toBe('alert');
    expect((await run('lobsterboard-release', { '/api/lb-release': { current: '0.9.1', latest: 'v0.9.1' } })).state).toBe('working');
  });

  it('Agent Wall panels: near the limit is amber, over it is rate limited, a login error is red', async () => {
    const win = tower(routes({ '/api/ai-usage/claude': u => ({ metrics: [{ label: 'Session (5h)', used: 85, limit: 100 }, { label: 'Weekly', used: 40, limit: 100 }] }) }));
    expect((await win.TowerLive.panel({ type: 'claude-code' })).state).toBe('near');
    const over = tower(routes({ '/api/ai-usage/codex': { metrics: [{ label: 'Session', used: 100, limit: 100 }] } }));
    expect((await over.TowerLive.panel({ type: 'codex-cli' })).state).toBe('limited');
    const out = tower(routes({ '/api/ai-usage/cursor': { error: 'Not logged in', metrics: [] } }));
    expect((await out.TowerLive.panel({ type: 'cursor' })).state).toBe('error');
  });

  it('weather codes map to the sky', () => {
    const { TowerLive } = tower();
    expect([0, 2, 45, 61, 73, 95].map(TowerLive.wmoKind)).toEqual(['clear', 'clouds', 'fog', 'rain', 'snow', 'storm']);
  });
});
