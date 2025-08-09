// === app.js (updated) ===
const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

function sanitizeFileName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/gi, '_');
}

// Ensure the data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// === Upload Checklist ===
app.post('/upload-checklist', upload.single('csvFile'), (req, res) => {
  const { sport, setName } = req.body;
  const filePath = req.file.path;

  if (!sport || !setName) {
    return res.status(400).send('Missing sport or set name');
  }

  const dbName = `${sanitizeFileName(sport)}_${sanitizeFileName(setName)}.db`;
  const dbPath = path.join(dataDir, dbName);

  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const db = new sqlite3.Database(dbPath);

  db.serialize(() => {
    db.run(`CREATE TABLE cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_number TEXT,
      athlete_name TEXT,
      rookie TEXT,            -- <-- normalized column name
      subset TEXT,
      card_type TEXT
    )`);

    db.run(`CREATE TABLE parallels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER,
      parallel_name TEXT,
      parallel_numbering TEXT,
      FOREIGN KEY(card_id) REFERENCES cards(id)
    )`);

    const insertCard = db.prepare(`INSERT INTO cards 
      (card_number, athlete_name, rookie, subset, card_type)
      VALUES (?, ?, ?, ?, ?)`);

    const insertParallel = db.prepare(`INSERT INTO parallels 
      (card_id, parallel_name, parallel_numbering)
      VALUES (?, ?, ?)`);

    const rows = [];
    const headers = [];

    fs.createReadStream(filePath)
      .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase().replace(/\s+/g, '_') }))
      .on('headers', (hdrs) => headers.push(...hdrs))
      .on('data', (row) => rows.push(row))
      .on('end', () => {
        let pending = rows.length;
        if (pending === 0) {
          insertCard.finalize();
          insertParallel.finalize();
          db.close();
          fs.unlinkSync(filePath);
          return res.redirect('/upload-success.html');
        }

        rows.forEach((row) => {
          insertCard.run([
            row['card_number'],
            row['athlete_full_name'] || row['athlete_name'] || row['athlete'],
            row['rookie'],
            row['subset'],
            row['type'] || row['card_type']
          ], function (err) {
            if (err) return console.error(err);
            const cardId = this.lastID;

            headers.forEach((header, idx) => {
              const h = String(header).toLowerCase();
              const isParallelName = h.includes('parallel') && !h.includes('numbering');
              if (isParallelName) {
                const parallelName = row[header];
                if (parallelName) {
                  const numberingHeader = headers[idx + 1];
                  const parallelNumbering = numberingHeader && String(numberingHeader).toLowerCase().includes('numbering') ? row[numberingHeader] : '';
                  insertParallel.run([cardId, parallelName, parallelNumbering]);
                }
              }
            });

            pending--;
            if (pending === 0) {
              insertCard.finalize();
              insertParallel.finalize();
              db.close();
              fs.unlinkSync(filePath);
              res.redirect('/upload-success.html');
            }
          });
        });
      });
  });
});

// === Legacy Checklist Viewer Endpoint (kept) ===
// Still available at /checklist but we recommend /api/checklist
app.get('/checklist', (req, res) => {
  const { sport, set, page = 1 } = req.query;
  const dbName = `${sanitizeFileName(sport)}_${sanitizeFileName(set)}.db`;
  const dbPath = path.join(dataDir, dbName);

  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'Checklist not found' });
  }

  const db = new sqlite3.Database(dbPath);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  db.serialize(() => {
    db.get('SELECT COUNT(*) as count FROM cards', (err, countResult) => {
      if (err) return res.status(500).json({ error: 'DB count error' });

      const totalPages = Math.ceil(countResult.count / pageSize);

      db.all('SELECT * FROM cards ORDER BY id LIMIT ? OFFSET ?', [pageSize, offset], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB query error' });

        res.json({
          cards: rows,
          totalPages
        });
      });
    });
  });
});

// === Mount API Routes (order matters only for overlapping paths) ===
app.use(require('./routes/card-set-api'));     // GET /api/card-sets?sport=...
app.use(require('./routes/checklist-api'));    // GET /api/checklist?sport=...&set=...
app.use(require('./routes/athlete-api'));      // GET /api/athletes, /api/athlete-summary

// If you still have a separate athlete-summary-api file, remove it or ensure paths don’t collide
// app.use(require('./routes/athlete-summary-api'));

// === Default Route ===
app.get('/', (req, res) => {
  res.send('<h2>Welcome to the Sports Card Checklist App</h2><p>Visit <a href="/upload.html">/upload.html</a> to upload a checklist or <a href="/view-checklist.html">/view-checklist.html</a> to view one.</p>');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
