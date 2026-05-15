// Queries a DayZ server via Steam A2S (using gamedig).
// Returns { ok, online, max, queue, name, map } or { ok: false, error }.

const { GameDig } = require('gamedig');

async function query({ host, port }) {
  try {
    const r = await GameDig.query({
      type: 'dayz',
      host,
      port: parseInt(port, 10),
      socketTimeout: 5000,
      attemptTimeout: 10000,
      maxAttempts: 2,
    });

    // DayZ rarely exposes queue length through A2S. Some servers publish it
    // through DZSA-style rules; we try a couple of common keys and fall back
    // to 0. If your server exposes it differently, edit here.
    let queue = 0;
    if (r.raw && typeof r.raw === 'object') {
      queue = parseInt(r.raw.queue ?? r.raw.numOpenPubConn ?? 0, 10) || 0;
    }

    return {
      ok: true,
      online: r.players?.length ?? r.numplayers ?? 0,
      max: r.maxplayers ?? 60,
      queue,
      name: r.name || '',
      map: r.map || '',
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function progressBar(cur, max, len = 10) {
  if (!max || max <= 0) return '▱'.repeat(len);
  const filled = Math.min(len, Math.max(0, Math.round((cur / max) * len)));
  return '▰'.repeat(filled) + '▱'.repeat(len - filled);
}

module.exports = { query, progressBar };
