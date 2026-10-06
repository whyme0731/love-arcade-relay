/* ==========================================================================
   love-arcade-relay — a tiny, single-purpose server for "Our Little Arcade".
   It does exactly two things and stores nothing:

   1. SIGNALING  (/peerjs)  – introduces the two browsers to each other (PeerJS).
   2. TURN CREDS (/turn)    – hands out short-lived TURN relay credentials so video
                              calls work on strict Wi-Fi / mobile / VPN networks.
                              The secret keys live ONLY in this server's environment.

   It shares nothing with any other app: its own repo, its own Render service,
   its own URL, its own environment variables.
   ========================================================================== */
const http = require('http');
const express = require('express');
const cors = require('cors');
const { ExpressPeerServer } = require('peer');

const PORT = process.env.PORT || 5191;
const KEY = process.env.PEER_KEY || 'lovearcade';
// e.g. ALLOWED_ORIGINS=https://yourname.github.io   (comma separated; empty = allow all)
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const app = express();
app.set('trust proxy', 1);
const corsOpts = {
  origin: (origin, cb) => cb(null, !origin || !ORIGINS.length || ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)),
  methods: ['GET', 'POST', 'OPTIONS']
};
app.use(cors(corsOpts));

/* ---------- health (also used by the site to wake a sleeping free instance) ---------- */
app.get('/', (req, res) => res.type('text').send('love-arcade-relay is running 💕'));
app.get('/health', (req, res) => res.json({ ok: true, t: Date.now() }));

/* ---------- tiny per-IP rate limit for /turn ---------- */
const hits = new Map();
setInterval(() => hits.clear(), 60 * 1000).unref();
const limited = (req, res, next) => {
  const n = (hits.get(req.ip) || 0) + 1; hits.set(req.ip, n);
  if (n > 30) return res.status(429).json({ error: 'slow down' });
  next();
};

/* ---------- TURN credentials ----------
   Pick ONE provider (both have free tiers) and set its variables in Render:
   • Cloudflare Realtime TURN : CF_TURN_KEY_ID + CF_TURN_API_TOKEN
   • Metered TURN             : METERED_APP (your app name) + METERED_API_KEY
   Without either, /turn returns STUN only (fine on most home networks).        */
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
let cache = null;

/* Long-lived credentials mean the phones only need this server about once a week (it can sleep in between).
   If Cloudflare refuses the long lifetime we fall back to 24h, so a bad setting can never break video. */
let credTtl = 0;
async function mintCloudflare() {
  const want = [Number(process.env.TURN_TTL) || 604800, 86400];
  let lastErr;
  for (const ttl of want) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.CF_TURN_KEY_ID}/credentials/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl })
      });
      if (!r.ok) throw new Error('cloudflare ' + r.status);
      const j = await r.json();
      const s = j.iceServers;
      credTtl = ttl;
      return Array.isArray(s) ? s : [s];
    } catch (e) { lastErr = e; console.error('TURN mint with ttl ' + ttl + ' failed:', e.message); }
  }
  throw lastErr;
}
async function mintMetered() {
  const r = await fetch(`https://${process.env.METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`);
  if (!r.ok) throw new Error('metered ' + r.status);
  return await r.json();
}
async function getIce() {
  if (cache && Date.now() < cache.until) return cache.servers;
  let turn = [];
  try {
    if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN) turn = await mintCloudflare();
    else if (process.env.METERED_APP && process.env.METERED_API_KEY) turn = await mintMetered();
  } catch (e) { console.error('TURN credential error:', e.message); }
  const servers = [...STUN, ...turn];
  cache = { servers, until: Date.now() + (turn.length ? 30 * 60 * 1000 : 60 * 1000) };   // retry quickly if minting failed
  return servers;
}
app.get('/turn', limited, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const iceServers = await getIce();
  res.json({ iceServers, turn: iceServers.length > STUN.length, ttl: credTtl || 86400 });
});

/* ---------- PeerJS signaling ---------- */
const server = http.createServer(app);
const peerServer = ExpressPeerServer(server, {
  path: '/',
  key: KEY,
  proxied: true,
  allow_discovery: false,           // nobody can list the rooms
  concurrent_limit: 200,
  corsOptions: corsOpts
});
app.use('/peerjs', peerServer);

server.listen(PORT, () => console.log(`love-arcade-relay listening on :${PORT} (origins: ${ORIGINS.join(', ') || 'any'})`));
