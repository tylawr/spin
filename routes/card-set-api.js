// routes/card-set-api.js
const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const dataDir = path.join(__dirname, '..', 'data');

function sanitizeFileName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/gi, '_');
}

// GET /api/card-sets?sport=...
// Returns an array of set names for the given sport based on files in /data
router.get('/api/card-sets', (req, res) => {
  const { sport } = req.query;
  if (!sport) {
    return res.status(400).json({ error: 'Missing sport parameter' });
  }

  const sportPrefix = sanitizeFileName(sport) + '_';
  try {
    const files = fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith(sportPrefix) && f.endsWith('.db'))
      .map(f => f.slice(sportPrefix.length, -3).replace(/_/g, ' '))
      .sort((a, b) => a.localeCompare(b));
    res.json(files);
  } catch (err) {
    console.error('Error reading data directory:', err);
    res.status(500).json({ error: 'Could not list sets' });
  }
});

module.exports = router;
