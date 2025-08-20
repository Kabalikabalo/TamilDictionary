// server.js — stream lookups (no full-file load)
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Streaming JSON pieces
const {parser} = require('stream-json');
const {streamObject} = require('stream-json/streamers/StreamObject');

const app = express();
const PORT = process.env.PORT || 3000;
const DICT_PATH = process.env.DICT_PATH || path.join(__dirname, 'dictionary.json');

app.use(cors());

// Tiny LRU cache to avoid re-scanning on repeated hits
const CACHE_LIMIT = Number(process.env.CACHE_LIMIT || 200);
const cache = new Map(); // key -> value
function cacheGet(k) {
  if (!cache.has(k)) return undefined;
  const v = cache.get(k);
  cache.delete(k);        // refresh recency
  cache.set(k, v);
  return v;
}
function cacheSet(k, v) {
  if (cache.has(k)) cache.delete(k);
  cache.set(k, v);
  if (cache.size > CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

// Health endpoint
app.get('/health', (_req, res) => res.json({ok: true}));

// GET /word/:key — stream the big JSON and return only the requested entry
app.get('/word/:key', async (req, res) => {
  const wantedKey = req.params.key;

  // quick cache hit
  const cached = cacheGet(wantedKey);
  if (cached !== undefined) return res.json(cached);

  // stream the file and iterate top-level object entries
  const readStream = fs.createReadStream(DICT_PATH, {highWaterMark: 1024 * 64}); // 64KB chunks
  const pipeline = readStream
    .pipe(parser())
    .pipe(streamObject()); // emits {key, value} for each top-level property

  let responded = false;

  pipeline.on('data', ({key, value}) => {
    if (key === wantedKey) {
      responded = true;
      cacheSet(wantedKey, value);
      // stop reading more to keep memory low
      readStream.destroy();
      pipeline.destroy();
      res.json(value);
    }
  });

  pipeline.on('end', () => {
    if (!responded) res.status(404).json({error: 'Word not found'});
  });

  pipeline.on('error', (err) => {
    if (!responded) res.status(500).json({error: 'Server error', detail: String(err)});
  });
});

// Optional: prefix search without loading whole file (streams through all keys)
app.get('/search', (req, res) => {
  const q = (req.query.q || '').toString();
  if (!q) return res.status(400).json({error: 'Missing ?q='});
  const limit = Math.min(Number(req.query.limit || 50), 200);

  const readStream = fs.createReadStream(DICT_PATH, {highWaterMark: 1024 * 64});
  const pipeline = readStream.pipe(parser()).pipe(streamObject());

  const matches = [];
  pipeline.on('data', ({key}) => {
    if (key.startsWith(q)) {
      matches.push(key);
      if (matches.length >= limit) {
        readStream.destroy();
        pipeline.destroy();
        res.json({matches, truncated: true});
      }
    }
  });
  pipeline.on('end', () => res.json({matches, truncated: false}));
  pipeline.on('error', (err) => res.status(500).json({error: 'Server error', detail: String(err)}));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Dictionary path: ${DICT_PATH}`);
});
