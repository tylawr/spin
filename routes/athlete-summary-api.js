// === athlete-summary-api.js ===
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const router = express.Router();

function sanitizeFileName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/gi, '_');
}

const dataDir = path.join(__dirname, '../data');

router.get('/api/athlete-summary', (req, res) => {
  const { sport, set, athlete } = req.query;
  const dbName = `${sanitizeFileName(sport)}_${sanitizeFileName(set)}.db`;
  const dbPath = path.join(dataDir, dbName);

  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'Checklist not found' });
  }

  const db = new sqlite3.Database(dbPath);

  db.all(
    `SELECT c.subset, c.card_type, c.is_rookie, p.parallel_name, p.parallel_numbering
     FROM cards c
     LEFT JOIN parallels p ON c.id = p.card_id
     WHERE LOWER(c.athlete_name) = LOWER(?)`,
    [athlete],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB query error' });

      if (!rows.length) {
        return res.json({ athlete, cardTypeCount: 0, totalParallelCards: 0, breakdown: [], isRookie: false });
      }

      const summary = {
        cardTypes: new Set(),
        totalParallelCards: 0,
        breakdown: {},
        isRookie: false,
      };

      rows.forEach((row) => {
        if (row.card_type) summary.cardTypes.add(row.card_type);
        if (row.is_rookie && row.is_rookie.toLowerCase() === 'rookie') {
          summary.isRookie = true;
        }

        const key = `${row.subset || 'Unknown'}|${row.card_type || 'Unknown'}`;
        const count = parseInt(row.parallel_numbering) || 0;

        if (!summary.breakdown[key]) {
          summary.breakdown[key] = {
            subset: row.subset || 'Unknown',
            cardType: row.card_type || 'Unknown',
            total: 0,
          };
        }

        summary.breakdown[key].total += count;
        summary.totalParallelCards += count;
      });

      res.json({
        athlete,
        cardTypeCount: summary.cardTypes.size,
        totalParallelCards: summary.totalParallelCards,
        breakdown: Object.values(summary.breakdown),
        isRookie: summary.isRookie,
      });
    }
  );
});

module.exports = router;
