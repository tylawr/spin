// routes/athlete-api.js
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

// Small promise helpers
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (e, rows) => (e ? reject(e) : resolve(rows))));
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (e, row) => (e ? reject(e) : resolve(row))));
}

async function detectSchema(db) {
  const cardsCols = await all(db, 'PRAGMA table_info(cards)');
  const parCols   = await all(db, 'PRAGMA table_info(parallels)');
  const has = (cols, name) => cols.some(c => String(c.name).toLowerCase() === name);

  // Rookie column lives on CARDS. You told me it's named exactly "rookie".
  // We'll still fall back to is_rookie if some DBs used an older name.
  const rookieCol = has(cardsCols, 'rookie') ? 'rookie'
                   : (has(cardsCols, 'is_rookie') ? 'is_rookie' : null);

  // Numbering column lives on PARALLELS. Some DBs use parallel_numbering, some use numbering.
  const numberingCol = has(parCols, 'parallel_numbering') ? 'parallel_numbering'
                      : (has(parCols, 'numbering') ? 'numbering' : null);

  return { rookieCol, numberingCol };
}

// ---------------------------------------------------------
// GET /api/athletes?sport=...&set=...
// Returns distinct athlete list for given sport + set
// ---------------------------------------------------------
router.get('/api/athletes', (req, res) => {
  const { sport, set } = req.query;
  if (!sport || !set) {
    return res.status(400).json({ error: 'Missing sport or set parameter' });
  }

  const { db, error, code } = openDbForChecklist(sport, set);
  if (error) return res.status(code).json({ error });

  db.all(
    `SELECT DISTINCT c.athlete_name AS name
       FROM cards c
      WHERE c.athlete_name IS NOT NULL AND TRIM(c.athlete_name) <> ''
      ORDER BY LOWER(c.athlete_name) ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB query error' });
      const athletes = rows.map(r => r.name);
      res.json({ sport, set, count: athletes.length, athletes });
    }
  );
});

// ---------------------------------------------------------
// GET /api/athlete-summary?sport=...&set=...&athlete=...
// - Rookie flag is STRICT to value 'Rookie' in the rookie column on CARDS
// - Totals are SUM of numbering from PARALLELS
// - Robust to per-DB schema differences
// ---------------------------------------------------------
router.get('/api/athlete-summary', async (req, res) => {
  const { sport, set, athlete } = req.query;
  if (!sport || !set || !athlete) {
    return res.status(400).json({ error: 'Missing sport, set, or athlete parameter' });
  }

  const { db, error, code } = openDbForChecklist(sport, set);
  if (error) return res.status(code).json({ error });

  try {
    const { rookieCol, numberingCol } = await detectSchema(db);

    // Compute rookie flag from CARDS only — no join duplication
    let isRookie = false;
    if (rookieCol) {
      const row = await get(
        db,
        `SELECT MAX(CASE WHEN LOWER(TRIM(${rookieCol})) = 'rookie' THEN 1 ELSE 0 END) AS flag
           FROM cards
          WHERE LOWER(athlete_name) = LOWER(?)`,
        [athlete]
      );
      isRookie = !!(row && row.flag === 1);
    } else {
      // If a particular DB truly lacks any rookie column, default to false
      isRookie = false;
    }

    // If numbering column is missing, fail softly (return zeroes) instead of 500
    if (!numberingCol) {
      return res.json({
        athlete,
        isRookie,
        cardTypeCount: 0,
        totalParallelCards: 0,
        autographCount: 0,
        autographRelicCount: 0,
        breakdown: []
      });
    }

    const rows = await all(
      db,
      `SELECT c.subset, c.card_type, p.${numberingCol} AS numbering
         FROM cards c
    LEFT JOIN parallels p ON c.id = p.card_id
        WHERE LOWER(c.athlete_name) = LOWER(?)`,
      [athlete]
    );

    if (!rows || !rows.length) {
      return res.json({
        athlete,
        isRookie,
        cardTypeCount: 0,
        totalParallelCards: 0,
        autographCount: 0,
        autographRelicCount: 0,
        breakdown: []
      });
    }

    const group = new Map(); // key: `${subset}||${card_type}` -> sum(numbering)
    let totalNumbered = 0;
    let autographNumbered = 0;
    let autographRelicNumbered = 0;

    for (const r of rows) {
      const subset = r.subset || '';
      const cardType = r.card_type || '';
      const key = `${subset}||${cardType}`;
      const n = Number(r.numbering) || 0;

      group.set(key, (group.get(key) || 0) + n);
      totalNumbered += n;

      const sLc = subset.toLowerCase();
      if (sLc === 'autograph') autographNumbered += n;
      if (sLc === 'autograph relic') autographRelicNumbered += n;
    }

    const breakdown = Array.from(group.entries()).map(([k, total]) => {
      const [subset, cardType] = k.split('||');
      return { subset, cardType, total };
    });

    const cardTypeCount = new Set(breakdown.map(b => (b.cardType || '').trim())).size;

    res.json({
      athlete,
      isRookie,
      cardTypeCount,
      totalParallelCards: totalNumbered,
      autographCount: autographNumbered,
      autographRelicCount: autographRelicNumbered,
      breakdown
    });
  } catch (e) {
    console.error('athlete-summary error:', e);
    res.status(500).json({ error: 'DB query error' });
  }
});

module.exports = router;
