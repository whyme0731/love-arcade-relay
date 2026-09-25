# love-arcade-relay

A tiny server for **Our Little Arcade**. It stores nothing and shares nothing with any other app — it has its **own GitHub repo, its own Render service, its own URL and its own secret keys**.

| Endpoint | What it does |
|---|---|
| `/peerjs` | Introduces the two browsers to each other (PeerJS signaling) |
| `/turn` | Returns short-lived **TURN** credentials so video calls work on strict networks |
| `/health` | Health check (the site also pings it to wake a sleeping free instance) |

## Deploy (about 10 minutes)

### Step 1 — get free TURN credentials (this is what fixes video on tricky networks)
Pick **one**:

**Cloudflare Realtime TURN** (free tier is very generous)
1. Cloudflare dashboard → **Realtime → TURN** → **Create**.
2. Copy the **TURN Key ID** and the **API Token**.
   → you'll set `CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN`.

**or Metered** (free tier)
1. Sign up at metered.ca → create an app → copy the **app name** (the part before `.metered.live`) and the **API key**.
   → you'll set `METERED_APP` and `METERED_API_KEY`.

### Step 2 — put this folder on GitHub (a NEW repo)
```
cd E:\love-arcade-relay
git remote add origin https://github.com/<your-username>/love-arcade-relay.git
git push -u origin main
```

### Step 3 — create the Render service
1. Render dashboard → **New → Blueprint** → pick the `love-arcade-relay` repo (it reads `render.yaml`).
   It creates a **new, separate** web service named `love-arcade-relay`.
2. When asked for the environment variables, fill in:
   - `ALLOWED_ORIGINS` = your site's address, e.g. `https://<your-username>.github.io`
   - your TURN variables from Step 1
   - (`PEER_KEY` is already `lovearcade` — keep it, it must match the site's `config.js`)
3. Wait for it to go live. Open `https://love-arcade-relay.onrender.com/turn` — you should see JSON that includes a TURN entry (`"turn": true`).

### Step 4 — tell the site about it
In the site repo's `config.js`:
```js
relay: 'love-arcade-relay.onrender.com',
```
Commit + push. Done.

## Notes
- **Free instance sleeps** after ~15 min idle and takes up to a minute to wake. The site pings it as soon as the page opens, and if it's still asleep it silently uses the free public server instead — so a connection is never blocked. (Upgrade the Render plan if you want it always awake.)
- **Security:** only your site's origin may fetch `/turn`; TURN secrets never leave the server; nobody can list the rooms.
- **Run locally:** `npm install && node server.js` (port 5191).
