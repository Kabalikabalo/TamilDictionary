const express = require('express');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Load the dictionary once when the server starts
const dictionary = JSON.parse(fs.readFileSync('dictionary.json', 'utf8'));

// Helper to extract Tamil words from the entry
function extractTamilWords(entry) {
  let tamilWords = [];
  if (typeof entry === 'object') {
    for (const key in entry) {
      if (Array.isArray(entry[key])) {
        entry[key].forEach(arr => {
          tamilWords = tamilWords.concat(arr);
        });
      } else if (typeof entry[key] === 'object') {
        tamilWords = tamilWords.concat(extractTamilWords(entry[key]));
      }
    }
  }
  return tamilWords;
}

app.get('/word/:key', (req, res) => {
  const key = req.params.key;
  const entry = dictionary[key];
  if (!entry) {
    return res.status(404).json({ error: 'Word not found' });
  }
  const tamilWords = extractTamilWords(entry);
  res.json({ tamil: tamilWords });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
