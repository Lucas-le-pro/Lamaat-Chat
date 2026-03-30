const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'chat.db'));

// Performance
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ── Schéma ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT    NOT NULL UNIQUE,
    password  TEXT    NOT NULL,
    avatar    TEXT    DEFAULT '😀',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    is_dm     INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS room_members (
    room_id   INTEGER,
    user_id   INTEGER,
    PRIMARY KEY (room_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id   INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    content   TEXT    NOT NULL,
    sent_at   INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, sent_at);
`);

// ── Requêtes préparées ────────────────────────────────────────
const queries = {
  createUser:   db.prepare('INSERT INTO users (username, password, avatar) VALUES (?, ?, ?)'),
  getUserByName:db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserById:  db.prepare('SELECT id, username, avatar FROM users WHERE id = ?'),
  getAllUsers:  db.prepare('SELECT id, username, avatar FROM users ORDER BY username'),

  createRoom:   db.prepare('INSERT INTO rooms (name, is_dm, created_by) VALUES (?, ?, ?)'),
  getUserRooms: db.prepare(`
    SELECT r.id, r.name, r.is_dm, r.created_by,
           MAX(m.sent_at) as last_msg_at
    FROM rooms r
    JOIN room_members rm ON rm.room_id = r.id
    LEFT JOIN messages m ON m.room_id = r.id
    WHERE rm.user_id = ?
    GROUP BY r.id
    ORDER BY last_msg_at DESC
  `),
  addMember:    db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)'),
  getMembers:   db.prepare(`
    SELECT u.id, u.username, u.avatar FROM users u
    JOIN room_members rm ON rm.user_id = u.id
    WHERE rm.room_id = ?
  `),
  isMember:     db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?'),

  insertMsg:    db.prepare('INSERT INTO messages (room_id, user_id, content) VALUES (?, ?, ?)'),
  getMessages:  db.prepare(`
    SELECT m.id, m.content, m.sent_at, u.id as user_id, u.username, u.avatar
    FROM messages m JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ?
    ORDER BY m.sent_at ASC
    LIMIT 100
  `),

  findDM: db.prepare(`
    SELECT r.id FROM rooms r
    JOIN room_members rm1 ON rm1.room_id = r.id AND rm1.user_id = ?
    JOIN room_members rm2 ON rm2.room_id = r.id AND rm2.user_id = ?
    WHERE r.is_dm = 1
    LIMIT 1
  `),
};

// Salon Général par défaut
const general = db.prepare('SELECT id FROM rooms WHERE name=? AND is_dm=0').get('Général');
if (!general) {
  db.prepare('INSERT INTO rooms (id, name, is_dm) VALUES (1, ?, 0)').run('Général');
}

module.exports = { db, queries };
