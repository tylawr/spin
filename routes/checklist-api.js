// routes/checklist-api.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const router = express.Router();
const dataDir = path.join(__dirname, '..', 'data');

function sanitizeFileName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/gi, '_');
}

function openDbForChecklist(sport, set) {
  const dbName = `${sanitizeFileName(sport)}_${sanitizeFileName(set)}.db`;
  const dbPath = path.join(dataDir, dbName);
  if (!fs.existsSync(dbPath)) return { error: 'Checklist not found', code: 404 };
  return { db: new sqlite3.Database(dbPath) };
}

function all(db, sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows))); }

router.get('/api/checklist', async (req, res) => {
  const { sport, set } = req.query;
  if (!sport || !set) return res.status(400).json({ error: 'Missing sport or set parameter' });

  const { db, error, code } = openDbForChecklist(sport, set);
  if (error) return res.status(code).json({ error });

  try {
    // Detect whether parallels table exists and which numbering column is present
    const parTable = await all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='parallels'");
    const hasParallels = parTable.length > 0;
    let numberingCol = null;
    if (hasParallels) {
      const parCols = await all(db, 'PRAGMA table_info(parallels)');
      const names = parCols.map(c => String(c.name).toLowerCase());
      numberingCol = names.includes('parallel_numbering') ? 'parallel_numbering' : (names.includes('numbering') ? 'numbering' : null);
    }

    let rows;
    if (hasParallels && numberingCol) {
      rows = await all(
        db,
        `SELECT c.subset, c.athlete_name, c.card_type, p.parallel_name, p.${numberingCol} AS parallel_numbering
           FROM cards c
      LEFT JOIN parallels p ON c.id = p.card_id
          ORDER BY LOWER(c.subset), LOWER(c.athlete_name)`
      );
    } else {
      // No parallels table or no numbering column: return cards only
      rows = await all(
        db,
        `SELECT c.subset, c.athlete_name, c.card_type, NULL AS parallel_name, NULL AS parallel_numbering
           FROM cards c
          ORDER BY LOWER(c.subset), LOWER(c.athlete_name)`
      );
    }

    return res.json(rows);
  } catch (e) {
    console.error('checklist error:', e);
    return res.status(500).json({ error: 'DB query error' });
  }
});

module.exports = router;