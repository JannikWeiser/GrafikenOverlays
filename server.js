const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');

const HOSTS = {
  'dav-stage': { label: 'DAV Staging (Test)', base: 'https://dav-stage.results.info' },
  dav: { label: 'DAV Produktion', base: 'https://dav.results.info' },
  ifsc: { label: 'IFSC Produktion', base: 'https://ifsc.results.info' },
};

const EVENT_TTL_MS = 20_000;
const ROUND_TTL_MS = 3_000;
const cache = new Map();

async function cachedFetch(cacheKey, url, ttlMs) {
  const hit = cache.get(cacheKey);
  const now = Date.now();
  if (hit && now - hit.fetchedAt < ttlMs) return hit.data;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Referer: `${new URL(url).origin}/`,
    },
  });
  if (!res.ok) {
    const err = new Error(`results.info ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  cache.set(cacheKey, { data, fetchedAt: now });
  return data;
}

function getHost(key) {
  const host = HOSTS[key];
  if (!host) {
    const err = new Error(`Unbekannter Tenant: ${key}`);
    err.status = 400;
    throw err;
  }
  return host;
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/hosts', (req, res) => {
  res.json(Object.entries(HOSTS).map(([key, v]) => ({ key, label: v.label })));
});

app.get('/api/events/:host/:eventId', async (req, res) => {
  try {
    const host = getHost(req.params.host);
    const url = `${host.base}/api/v1/events/${req.params.eventId}`;
    const data = await cachedFetch(`event:${req.params.host}:${req.params.eventId}`, url, EVENT_TTL_MS);
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

app.get('/api/rounds/:host/:categoryRoundId', async (req, res) => {
  try {
    const host = getHost(req.params.host);
    const url = `${host.base}/api/v1/category_rounds/${req.params.categoryRoundId}/results`;
    const data = await cachedFetch(`round:${req.params.host}:${req.params.categoryRoundId}`, url, ROUND_TTL_MS);
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// Ecken-Einblendungen (Sponsor-Logos etc.): pro Slot ("left"/"right") liegt
// hoechstens EINE Datei auf der Platte. Ein neuer Upload ersetzt die alte
// Datei desselben Slots, statt sich anzusammeln - so bleibt die Upload-Menge
// unabhaengig davon, wie oft hochgeladen wird, immer auf max. 2 Dateien
// begrenzt. Zusaetzlich begrenzt multer die Groesse pro Datei.
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = {
  'image/png': { ext: 'png', kind: 'image' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'video/mp4': { ext: 'mp4', kind: 'video' },
  'video/webm': { ext: 'webm', kind: 'video' },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(ALLOWED_UPLOAD_TYPES[file.mimetype])),
});

function clearCornerFiles(slot) {
  for (const name of fs.readdirSync(UPLOADS_DIR)) {
    if (name.startsWith(`corner-${slot}.`)) fs.unlinkSync(path.join(UPLOADS_DIR, name));
  }
}

app.post('/api/uploads/:slot', (req, res) => {
  const { slot } = req.params;
  if (slot !== 'left' && slot !== 'right') return res.status(400).json({ error: 'Unbekannter Slot' });

  upload.single('file')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `Datei zu groß (max. ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB)`
        : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'Dateityp nicht erlaubt (nur PNG, JPG, MP4, WebM)' });

    const meta = ALLOWED_UPLOAD_TYPES[req.file.mimetype];
    clearCornerFiles(slot);
    const filename = `corner-${slot}.${meta.ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);

    // Sichtbarkeit/Groesse eines bereits bestehenden Slots bleiben beim
    // Austauschen der Datei erhalten; ein komplett neuer Slot startet
    // unsichtbar (Operator schaltet bewusst per Toggle live).
    const previous = config.corners[slot];
    const corner = {
      url: `/uploads/${filename}?v=${Date.now()}`,
      kind: meta.kind,
      visible: previous?.visible || false,
      scale: previous?.scale || 1,
    };
    config = { ...config, corners: { ...config.corners, [slot]: corner } };
    broadcast({ kind: 'config', config });
    res.json({ ok: true, corner });
  });
});

app.delete('/api/uploads/:slot', (req, res) => {
  const { slot } = req.params;
  if (slot !== 'left' && slot !== 'right') return res.status(400).json({ error: 'Unbekannter Slot' });

  clearCornerFiles(slot);
  config = { ...config, corners: { ...config.corners, [slot]: null } };
  broadcast({ kind: 'config', config });
  res.json({ ok: true });
});

const server = app.listen(process.env.PORT || 3000, () => {
  const { port } = server.address();
  console.log(`GrafikenOverlays laeuft auf http://localhost:${port}`);
  console.log(`  Control-Panel: http://localhost:${port}/control/`);
  console.log(`  Output (fuer OBS): http://localhost:${port}/output/`);
});

let liveState = { type: null, params: {} };
let config = { chromaColor: '#00ff00', transparentBackground: false, cardOpacity: 0.82, corners: { left: null, right: null } };

const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ kind: 'state', state: liveState }));
  ws.send(JSON.stringify({ kind: 'config', config }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.kind === 'setLive') {
      liveState = { type: msg.type || null, params: msg.params || {} };
      broadcast({ kind: 'state', state: liveState });
    } else if (msg.kind === 'clearLive') {
      liveState = { type: null, params: {} };
      broadcast({ kind: 'state', state: liveState });
    } else if (msg.kind === 'setConfig') {
      const patch = {};
      if (typeof msg.config?.chromaColor === 'string') patch.chromaColor = msg.config.chromaColor;
      if (typeof msg.config?.transparentBackground === 'boolean') patch.transparentBackground = msg.config.transparentBackground;
      if (typeof msg.config?.cardOpacity === 'number' && msg.config.cardOpacity >= 0 && msg.config.cardOpacity <= 1) {
        patch.cardOpacity = msg.config.cardOpacity;
      }
      if (Object.keys(patch).length) {
        config = { ...config, ...patch };
        broadcast({ kind: 'config', config });
      }
    } else if (msg.kind === 'setCornerConfig') {
      const { slot, patch } = msg;
      const current = (slot === 'left' || slot === 'right') && config.corners[slot];
      if (current && patch && typeof patch === 'object') {
        const next = { ...current };
        if (typeof patch.visible === 'boolean') next.visible = patch.visible;
        if (typeof patch.scale === 'number' && patch.scale > 0) next.scale = patch.scale;
        config = { ...config, corners: { ...config.corners, [slot]: next } };
        broadcast({ kind: 'config', config });
      }
    }
  });
});
