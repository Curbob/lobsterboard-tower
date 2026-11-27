/**
 * Lobster Tower: settings API for the LobsterBoard custom page.
 *
 *   GET  /api/pages/<id>/settings   → { sleepHours, hidden: [roomKey, ...] }
 *   POST /api/pages/<id>/settings   ← the same shape; saved to data/<id>/settings.json
 *
 * Settings live on the server so every browser opening the tower sees the same building.
 */
const DEFAULTS = { sleepHours: 2, hidden: [] };
const ROOM_KEY = /^[a-z]{2,20}$/;

function clean(input) {
  const s = input && typeof input === 'object' ? input : {};
  const sleep = Number(s.sleepHours);
  return {
    sleepHours: Number.isFinite(sleep) ? Math.min(48, Math.max(0.25, sleep)) : DEFAULTS.sleepHours,
    hidden: Array.isArray(s.hidden) ? [...new Set(s.hidden.filter(k => typeof k === 'string' && ROOM_KEY.test(k)))].slice(0, 50) : [],
  };
}

module.exports = function (ctx) {
  const read = () => {
    try { return clean(ctx.readData('settings.json')); } catch (_) { return { ...DEFAULTS }; }
  };
  return {
    routes: {
      'GET /settings': () => read(),
      'POST /settings': (req, res, { body }) => {
        const next = clean(body);
        ctx.writeData('settings.json', next);
        return next;
      },
    },
  };
};

module.exports.clean = clean;
