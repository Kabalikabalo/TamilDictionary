const express = require('express');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Load dictionary.json once at startup
const dictionary = JSON.parse(fs.readFileSync('dictionary.json', 'utf8'));

app.get('/word/:key', (req, res) => {
  const key = req.params.key;
  const entry = dictionary[key];
  if (!entry) {
    return res.status(404).json({ error: 'Word not found' });
  }
  // Just return the full object as is, including all headers/fields
  res.json(entry);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
