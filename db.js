import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'database.sqlite');
let db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    customerName TEXT DEFAULT '',
    phoneNumber TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    fileName TEXT,
    fileType TEXT,
    fileSize INTEGER,
    uploadDate TEXT,
    status TEXT DEFAULT 'PENDING',
    serverFileName TEXT,
    pageCount INTEGER,
    colorMode TEXT DEFAULT 'color',
    copies INTEGER DEFAULT 1,
    paperType TEXT DEFAULT 'normal',
    source TEXT DEFAULT 'upload',
    customerEmail TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS paper_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    nameAr TEXT NOT NULL DEFAULT '',
    colorPerPage REAL NOT NULL DEFAULT 30,
    blackWhitePerPage REAL NOT NULL DEFAULT 15,
    sortOrder INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS discount_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    discount_type TEXT NOT NULL,
    discount_value REAL NOT NULL,
    condition_type TEXT NOT NULL,
    threshold INTEGER NOT NULL,
    max_discount_cap REAL,
    priority INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS gmail_account (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gmail_email TEXT DEFAULT '',
    access_token TEXT DEFAULT '',
    refresh_token TEXT DEFAULT '',
    token_expiry TEXT,
    connected_at TEXT,
    is_active INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS processed_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gmail_message_id TEXT UNIQUE NOT NULL,
    processed_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS gmail_pending (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gmail_message_id TEXT UNIQUE NOT NULL,
    email_from TEXT,
    email_address TEXT,
    subject TEXT,
    body_preview TEXT,
    attachment_meta TEXT DEFAULT '[]',
    received_at TEXT,
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Auto-create the singleton gmail_account row if it doesn't exist
const gmailRow = db.prepare('SELECT id FROM gmail_account WHERE id = 1').get();
if (!gmailRow) {
  db.prepare('INSERT INTO gmail_account (id) VALUES (1)').run();
}

// Migrations for columns added after initial schema
try { db.exec(`ALTER TABLE jobs ADD COLUMN customerEmail TEXT DEFAULT ''`); } catch (e) {}
try { db.exec(`ALTER TABLE jobs ADD COLUMN source TEXT DEFAULT 'upload'`); } catch (e) {}
try { db.exec(`ALTER TABLE gmail_pending ADD COLUMN discarded_at TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE jobs ADD COLUMN paymentStatus TEXT DEFAULT 'UNPAID'`); } catch (e) {}
try { db.exec(`ALTER TABLE jobs ADD COLUMN paymentAmount REAL`); } catch (e) {}
try { db.exec(`ALTER TABLE jobs ADD COLUMN paymentDate TEXT`); } catch (e) {}

// Seed default paper types if table is empty
const paperTypeCount = db.prepare('SELECT COUNT(*) AS count FROM paper_types').get();
if (paperTypeCount.count === 0) {
  const insert = db.prepare('INSERT INTO paper_types (id, name, nameAr, colorPerPage, blackWhitePerPage, sortOrder) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('normal', 'Normal', 'عادي', 30, 15, 0);
  insert.run('glossy', 'Glossy', 'لامع', 50, 50, 1);
  insert.run('cardboard', 'Cardboard', 'ورق مقوى', 40, 40, 2);
}

// Migrate legacy paperTypes from settings key-value if paper_types table has defaults only
const legacyPaperTypes = (() => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'paperTypes'").get();
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
})();
if (legacyPaperTypes && Array.isArray(legacyPaperTypes) && legacyPaperTypes.length > 0) {
  const currentCount = db.prepare('SELECT COUNT(*) AS count FROM paper_types').get();
  if (currentCount.count <= 3) {
    const insert = db.prepare('INSERT OR REPLACE INTO paper_types (id, name, nameAr, colorPerPage, blackWhitePerPage, sortOrder) VALUES (?, ?, ?, ?, ?, ?)');
    legacyPaperTypes.forEach((pt, idx) => {
      insert.run(pt.id, pt.name, pt.nameAr || pt.name, pt.colorPerPage, pt.blackWhitePerPage, idx);
    });
  }
  db.prepare("DELETE FROM settings WHERE key = 'paperTypes'").run();
}

/**
 * Settings Helpers
 */
export const getSettings = () => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach(row => {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch (e) {
      settings[row.key] = row.value;
    }
  });
  return settings;
};

export const updateSetting = (key, value) => {
  const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, serializedValue);
};

/**
 * Paper Types Helpers
 */
export const getPaperTypes = () => {
  return db.prepare('SELECT * FROM paper_types ORDER BY sortOrder ASC').all();
};

export const replaceAllPaperTypes = (types) => {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM paper_types').run();
    const insert = db.prepare('INSERT INTO paper_types (id, name, nameAr, colorPerPage, blackWhitePerPage, sortOrder) VALUES (?, ?, ?, ?, ?, ?)');
    types.forEach((pt, idx) => {
      insert.run(pt.id, pt.name, pt.nameAr || pt.name, pt.colorPerPage, pt.blackWhitePerPage, idx);
    });
  });
  tx();
};

export const createPaperType = (pt) => {
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sortOrder), -1) AS maxOrder FROM paper_types').get();
  db.prepare('INSERT INTO paper_types (id, name, nameAr, colorPerPage, blackWhitePerPage, sortOrder) VALUES (?, ?, ?, ?, ?, ?)')
    .run(pt.id, pt.name, pt.nameAr || pt.name, pt.colorPerPage, pt.blackWhitePerPage, maxOrder.maxOrder + 1);
  return db.prepare('SELECT * FROM paper_types WHERE id = ?').get(pt.id);
};

export const updatePaperType = (id, updates) => {
  const fields = [];
  const values = [];
  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.nameAr !== undefined) { fields.push('nameAr = ?'); values.push(updates.nameAr); }
  if (updates.colorPerPage !== undefined) { fields.push('colorPerPage = ?'); values.push(updates.colorPerPage); }
  if (updates.blackWhitePerPage !== undefined) { fields.push('blackWhitePerPage = ?'); values.push(updates.blackWhitePerPage); }
  if (updates.sortOrder !== undefined) { fields.push('sortOrder = ?'); values.push(updates.sortOrder); }
  if (fields.length === 0) return null;
  values.push(id);
  db.prepare(`UPDATE paper_types SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM paper_types WHERE id = ?').get(id);
};

export const deletePaperType = (id) => {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM paper_types WHERE id = ?').run(id);
    // Re-index sortOrder
    const remaining = db.prepare('SELECT id FROM paper_types ORDER BY sortOrder ASC').all();
    const update = db.prepare('UPDATE paper_types SET sortOrder = ? WHERE id = ?');
    remaining.forEach((row, idx) => update.run(idx, row.id));
  });
  tx();
};

/**
 * Discount Rules Helpers
 */
export const getDiscountRules = () => {
  const rows = db.prepare('SELECT * FROM discount_rules ORDER BY priority DESC, created_at DESC').all();
  return rows.map(row => ({ ...row, is_active: Boolean(row.is_active) }));
};

export const getActiveDiscountRules = () => {
  const rows = db.prepare('SELECT * FROM discount_rules WHERE is_active = 1 ORDER BY priority DESC').all();
  return rows.map(row => ({ ...row, is_active: Boolean(row.is_active) }));
};

export const createDiscountRule = (rule) => {
  const { id, name, discount_type, discount_value, condition_type, threshold, max_discount_cap, priority, is_active } = rule;
  db.prepare(`
    INSERT INTO discount_rules (id, name, discount_type, discount_value, condition_type, threshold, max_discount_cap, priority, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, discount_type, discount_value, condition_type, threshold, max_discount_cap || null, priority || 0, is_active ? 1 : 0);
  return rule;
};

export const updateDiscountRule = (id, updates) => {
  const fields = [];
  const values = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.discount_type !== undefined) { fields.push('discount_type = ?'); values.push(updates.discount_type); }
  if (updates.discount_value !== undefined) { fields.push('discount_value = ?'); values.push(updates.discount_value); }
  if (updates.condition_type !== undefined) { fields.push('condition_type = ?'); values.push(updates.condition_type); }
  if (updates.threshold !== undefined) { fields.push('threshold = ?'); values.push(updates.threshold); }
  if (updates.max_discount_cap !== undefined) { fields.push('max_discount_cap = ?'); values.push(updates.max_discount_cap); }
  if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
  if (updates.is_active !== undefined) { fields.push('is_active = ?'); values.push(updates.is_active ? 1 : 0); }

  if (fields.length === 0) return null;

  values.push(id);
  db.prepare(`UPDATE discount_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return { id, ...updates };
};

export const deleteDiscountRule = (id) => {
  db.prepare('DELETE FROM discount_rules WHERE id = ?').run(id);
  return id;
};

/**
 * Token Encryption Helpers
 */
const ENCRYPTION_KEY = (() => {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required for token encryption');
  }
  return Buffer.from(keyHex, 'hex');
})();

function encryptToken(plaintext) {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decryptToken(ciphertext) {
  if (!ciphertext || !ciphertext.includes(':')) return '';
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return '';
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return '';
  }
}

/**
 * Gmail Account Helpers
 */
export const getGmailAccount = () => {
  const row = db.prepare('SELECT * FROM gmail_account WHERE id = 1').get();
  if (!row) return null;
  return {
    ...row,
    access_token: decryptToken(row.access_token),
    refresh_token: decryptToken(row.refresh_token),
  };
};

export const updateGmailTokens = ({ email, accessToken, refreshToken, expiryDate }) => {
  db.prepare(`
    UPDATE gmail_account 
    SET gmail_email = ?, access_token = ?, refresh_token = ?, token_expiry = ?, connected_at = CURRENT_TIMESTAMP, is_active = 1
    WHERE id = 1
  `).run(email || '', encryptToken(accessToken || ''), encryptToken(refreshToken || ''), expiryDate || null);
};

export const disconnectGmail = () => {
  db.prepare(`
    UPDATE gmail_account 
    SET gmail_email = '', access_token = '', refresh_token = '', token_expiry = NULL, is_active = 0
    WHERE id = 1
  `).run();
};

export const isEmailProcessed = (gmailMessageId) => {
  const row = db.prepare('SELECT id FROM processed_emails WHERE gmail_message_id = ?').get(gmailMessageId);
  return !!row;
};

export const markEmailProcessed = (gmailMessageId) => {
  db.prepare('INSERT OR IGNORE INTO processed_emails (gmail_message_id) VALUES (?)').run(gmailMessageId);
};

/**
 * Gmail Pending Emails (awaiting user review)
 */
export const getPendingEmails = () => {
  return db.prepare('SELECT * FROM gmail_pending WHERE discarded_at IS NULL ORDER BY fetched_at DESC').all();
};

export const isEmailPending = (gmailMessageId) => {
  const row = db.prepare('SELECT id FROM gmail_pending WHERE gmail_message_id = ?').get(gmailMessageId);
  return !!row;
};

export const addPendingEmail = ({ gmailMessageId, from, emailAddress, subject, bodyPreview, attachmentMeta, receivedAt }) => {
  db.prepare(`
    INSERT OR IGNORE INTO gmail_pending (gmail_message_id, email_from, email_address, subject, body_preview, attachment_meta, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(gmailMessageId, from || '', emailAddress || '', subject || '', bodyPreview || '', JSON.stringify(attachmentMeta || []), receivedAt || null);
};

export const softDeletePendingEmail = (id) => {
  db.prepare("UPDATE gmail_pending SET discarded_at = datetime('now') WHERE id = ?").run(id);
};

export const restorePendingEmail = (id) => {
  db.prepare("UPDATE gmail_pending SET discarded_at = NULL WHERE id = ?").run(id);
};

export const removePendingEmail = (id) => {
  db.prepare('DELETE FROM gmail_pending WHERE id = ?').run(id);
};

export const getPendingEmailById = (id) => {
  const row = db.prepare('SELECT * FROM gmail_pending WHERE id = ?').get(id);
  if (row) row.attachment_meta = JSON.parse(row.attachment_meta || '[]');
  return row;
};

export function reopenDb() {
  try { db.close(); } catch (e) { /* already closed */ }
  for (const ext of ['-wal', '-shm']) {
    const p = dbPath + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export { db as default };
