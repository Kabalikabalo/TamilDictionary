// server.js — fast lookups via shards (fallback to streaming dictionary.json)
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

// Streaming fallback (only used if shards aren't present)
const { parser } = require('stream-json');
const { streamObject } = require('stream-json/streamers/StreamObject');

const app = express();
const PORT = process.env.PORT || 3000;

// Paths
const SHARD_DIR = process.env.SHARD_DIR || path.join(__dirname, 'shards');
const MANIFEST_PATH = path.join(SHARD_DIR, 'manifest.json');
const DICT_PATH = process.env.DICT_PATH || path.join(__dirname, 'dictionary.json');

app.use(cors());
app.use(compression());

// Small LRU for entry responses (helps even with shards)
const CACHE_LIMIT = Number(process.env.CACHE_LIMIT || 1000);
const entryCache = new Map(); // key -> value
function cacheGet(k) {
  if (!entryCache.has(k)) return undefined;
  const v = entryCache.get(k);
  entryCache.delete(k);
  entryCache.set(k, v);
  return v;
}
function cacheSet(k, v) {
  if (entryCache.has(k)) entryCache.delete(k);
  entryCache.set(k, v);
  if (entryCache.size > CACHE_LIMIT) {
    entryCache.delete(entryCache.keys().next().value);
  }
}

// --- Shard helpers -----------------------------------------------------------

function bucketOf(key) {
  // Use first Unicode codepoint of trimmed key; lowercase ASCII
  if (typeof key !== 'string') return '_misc';
  const trimmed = key.trim();
  if (!trimmed) return '_misc';
  const first = Array.from(trimmed)[0] || '';
  return /[A-Za-z]/.test(first) ? first.toLowerCase() : first || '_misc';
}

function shardFilenameForBucket(bucket) {
  // Filenames are the bucket char + ".json"
  // (matches the splitter you ran; Tamil/Unicode chars are fine as filenames)
  return path.join(SHARD_DIR, `${bucket}.json`);
}

let shardsEnabled = false;
let manifest = null;
const shardCache = new Map(); // bucket -> Promise<object> (loaded shard)

async function initShardsIfAvailable() {
  try {
    await fsp.access(MANIFEST_PATH, fs.constants.R_OK);
    const raw = await fsp.readFile(MANIFEST_PATH, 'utf8');
    manifest = JSON.parse(raw);
    shardsEnabled = true;
    console.log(`[shards] Enabled. Shard dir: ${SHARD_DIR}`);
  } catch {
    shardsEnabled = false;
    console.log(`[shards] Not found. Using streaming fallback for ${DICT_PATH}`);
  }
}

async function loadShard(bucket) {
  if (shardCache.has(bucket)) return shardCache.get(bucket);
  const p = (async () => {
    const file = shardFilenameForBucket(bucket);
    try {
      const raw = await fsp.readFile(file, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      // Missing shard file → treat as empty
      return {};
    }
  })();
  shardCache.set(bucket, p);
  return p;
}

// --- Endpoints ---------------------------------------------------------------

app.get('/health', (_req, res) => res.json({ ok: true }));

// Exact-key lookup
app.get('/word/:key', async (req, res) => {
  try {
    const wantedKey = req.params.key;
    const hit = cacheGet(wantedKey);
    if (hit !== undefined) {
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      return res.json(hit);
    }

    // Prefer shards if available
    if (shardsEnabled) {
      const bucket = bucketOf(wantedKey);
      const shard = await loadShard(bucket);
      const value = shard[wantedKey];
      if (value !== undefined) {
        cacheSet(wantedKey, value);
        res.set('Cache-Control', 'public, max-age=86400, immutable');
        return res.json(value);
      }
      return res.status(404).json({ error: 'Word not found' });
    }

    // Fallback: stream the big JSON (no full-file load)
    const readStream = fs.createReadStream(DICT_PATH, { highWaterMark: 1024 * 128 });
    const pipeline = readStream.pipe(parser()).pipe(streamObject());
    let responded = false;

    pipeline.on('data', ({ key, value }) => {
      if (key === wantedKey) {
        responded = true;
        readStream.destroy();
        pipeline.destroy();
        cacheSet(wantedKey, value);
        res.set('Cache-Control', 'public, max-age=86400, immutable');
        res.json(value);
      }
    });
    pipeline.on('end', () => {
      if (!responded) res.status(404).json({ error: 'Word not found' });
    });
    pipeline.on('error', (err) => {
      if (!responded) res.status(500).json({ error: 'Server error', detail: String(err) });
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error', detail: String(e) });
  }
});

// Prefix search (fast with shards: only scans one shard based on first char)
app.get('/search', async (req, res) => {
  try {
    const qRaw = (req.query.q || '').toString();
    const q = qRaw.trim();
    if (!q) return res.status(400).json({ error: 'Missing ?q=' });
    const limit = Math.min(Number(req.query.limit || 50), 200);

    if (shardsEnabled) {
      const bucket = bucketOf(q);
      const shard = await loadShard(bucket);
      const matches = [];
      for (const k of Object.keys(shard)) {
        if (k.startsWith(q)) {
          matches.push(k);
          if (matches.length >= limit) break;
        }
      }
      res.set('Cache-Control', 'public, max-age=300');
      return res.json({ matches, truncated: matches.length >= limit });
    }

    // Fallback: stream entire dictionary keys
    const readStream = fs.createReadStream(DICT_PATH, { highWaterMark: 1024 * 128 });
    const pipeline = readStream.pipe(parser()).pipe(streamObject());
    const matches = [];

    pipeline.on('data', ({ key }) => {
      if (key.startsWith(q)) {
        matches.push(key);
        if (matches.length >= limit) {
          readStream.destroy();
          pipeline.destroy();
          res.set('Cache-Control', 'public, max-age=300');
          res.json({ matches, truncated: true });
        }
      }
    });
    pipeline.on('end', () => {
      res.set('Cache-Control', 'public, max-age=300');
      res.json({ matches, truncated: false });
    });
    pipeline.on('error', (err) => {
      res.status(500).json({ error: 'Server error', detail: String(err) });
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error', detail: String(e) });
  }
});

// Optional: expose shard manifest for debugging
app.get('/manifest', async (_req, res) => {
  if (!shardsEnabled) return res.status(404).json({ error: 'No shards' });
  res.json(manifest || {});
});

// Init + start
initShardsIfAvailable().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(shardsEnabled
      ? `Using shards at: ${SHARD_DIR}`
      : `Using streaming dictionary at: ${DICT_PATH}`);
  });
});
