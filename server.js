import 'dotenv/config';
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import os from "os";
import { PDFDocument } from "pdf-lib";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

import db, { getSettings, updateSetting, getPaperTypes, replaceAllPaperTypes, createPaperType, updatePaperType, deletePaperType, getDiscountRules, getActiveDiscountRules, createDiscountRule, updateDiscountRule, deleteDiscountRule, reopenDb } from './db.js';

// ── Magic byte signatures for file validation ──
const MAGIC_BYTES = {
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/png": [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  "image/tiff": [[0x49, 0x49, 0x2A, 0x00], [0x4D, 0x4D, 0x00, 0x2A]],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4B, 0x03, 0x04]],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [[0x50, 0x4B, 0x03, 0x04]],
};

function validateMagicBytes(filePath, mimeType) {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) return true; // unknown type, skip check
  const buf = Buffer.alloc(16);
  const fd = fs.openSync(filePath, "r");
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  return signatures.some(sig =>
    sig.every((byte, i) => buf[i] === byte)
  );
}

// ── Auth token management (persisted in DB) ──
function loadTokens() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = '_admin_tokens'").get();
    return row ? new Set(JSON.parse(row.value)) : new Set();
  } catch { return new Set(); }
}

function saveTokens(tokens) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('_admin_tokens', ?)").run(JSON.stringify([...tokens]));
}

const adminTokens = loadTokens();

function generateToken() {
  const token = randomBytes(32).toString("hex");
  adminTokens.add(token);
  saveTokens(adminTokens);
  return token;
}

function isValidAdminToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ") && adminTokens.has(auth.slice(7))) return true;
  return false;
}

// Middleware: require valid admin token
function requireAdmin(req, res, next) {
  if (!isValidAdminToken(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── Rate limiter (in-memory, per-IP) ──
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 5;         // 5 attempts per window

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }
  const timestamps = rateLimitMap.get(ip).filter(t => now - t < RATE_LIMIT_WINDOW);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: "Too many requests. Try again later." });
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  next();
}

// Clean up stale rate-limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitMap) {
    const fresh = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (fresh.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, fresh);
  }
}, 300_000);

// ── Allowed MIME types for upload ──
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || "development";
const isDev = NODE_ENV === "development";
const PORT = process.env.PORT || (isDev ? 3001 : 3000);

// Path configuration
const DIST_DIR = path.join(__dirname, "dist");
const UPLOADS_DIR = path.join(__dirname, "uploads");

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS for development (allow frontend on different port)
if (isDev) {
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "http://localhost:5000");
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'self';");
  next();
});

// Ensure directories exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DIST_DIR) && !isDev) {
  console.warn("⚠️  DIST_DIR does not exist. Run build first!");
}

/**
 * PDF Page Count Helper — uses pdf-lib for accurate counting.
 */

/**
 * PDF Page Count Helper — uses pdf-lib for accurate counting.
 * Handles encrypted and malformed PDFs gracefully.
 *
 * @param {string} filePath - Absolute path to the PDF file on disk.
 * @returns {Promise<number|null>} Page count, or null if the file cannot be read.
 */
const getPdfPageCount = async (filePath) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);

    // ignoreEncryption: true  — prevents a crash on password-protected PDFs
    //   (page count is still readable even for encrypted docs)
    // updateMetadata: false   — skip rewriting metadata; we only need page count
    const pdfDoc = await PDFDocument.load(fileBuffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    const pageCount = pdfDoc.getPageCount();
    console.log(
      `📄 PDF page count for ${path.basename(filePath)}: ${pageCount}`,
    );
    return pageCount;
  } catch (err) {
    console.error(
      `❌ Error reading PDF page count for ${path.basename(filePath)}:`,
      err.message,
    );
    return null;
  }
};

// Backfill missing pageCount for existing PDF jobs (runs once at startup)
const backfillPageCounts = async () => {
  const pdfJobsMissingCount = db.prepare(`
    SELECT * FROM jobs 
    WHERE fileType = 'application/pdf' 
    AND (pageCount IS NULL OR pageCount = 0)
  `).all();

  if (pdfJobsMissingCount.length === 0) {
    console.log("✅ All PDF jobs already have page counts.");
    return;
  }

  console.log(
    `📚 Backfilling page counts for ${pdfJobsMissingCount.length} PDF job(s)...`,
  );

  const updateStmt = db.prepare('UPDATE jobs SET pageCount = ? WHERE id = ?');

  for (const job of pdfJobsMissingCount) {
    if (!job.serverFileName) {
      console.warn(`  ⚠️  Job ${job.id} has no serverFileName — skipping.`);
      continue;
    }
    const filePath = path.join(UPLOADS_DIR, job.serverFileName);
    if (fs.existsSync(filePath)) {
      const count = await getPdfPageCount(filePath);
      if (count !== null) {
        updateStmt.run(count, job.id);
        console.log(`  ✅ ${job.fileName}: ${count} page(s)`);
      } else {
        console.warn(
          `  ⚠️  Could not count pages for ${job.fileName} — file may be corrupted.`,
        );
      }
    } else {
      console.warn(
        `  ⚠️  File not found for job ${job.id}`,
      );
    }
  }
};

// Run backfill (non-blocking — won't block server startup)
backfillPageCounts().catch((err) => console.error("❌ Backfill error:", err));

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const randomName = randomBytes(16).toString("hex");
    cb(null, randomName + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed. Allowed: PDF, DOCX, XLSX, JPEG, PNG, TIFF`));
    }
  },
});

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * API ROUTES
 */

// Favicon — inline SVG to avoid 404
app.get("/favicon.ico", (req, res) => {
  res.type("image/svg+xml").send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#2563eb"/><text x="32" y="44" font-size="36" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="bold">P</text></svg>`);
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// Get all jobs (admin only)
app.get("/api/jobs", requireAdmin, (req, res) => {
  const jobs = db.prepare('SELECT * FROM jobs ORDER BY uploadDate DESC').all();
  const formattedJobs = jobs.map(job => ({
    ...job,
    paymentAmount: job.paymentAmount || 0,
    paymentStatus: job.paymentStatus || 'UNPAID',
    printPreferences: {
      colorMode: job.colorMode,
      copies: job.copies,
      paperType: job.paperType || 'normal'
    }
  }));
  res.status(200).json(formattedJobs);
});

// Public query — get jobs by ID array (for "my recent uploads")
app.post("/api/jobs/query", (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(200).json([]);
  }
  const placeholders = ids.map(() => '?').join(',');
  const jobs = db.prepare(`SELECT * FROM jobs WHERE id IN (${placeholders}) ORDER BY uploadDate DESC`).all(...ids);
  const sanitized = jobs.map(job => ({
    id: job.id,
    fileName: job.fileName,
    fileType: job.fileType,
    fileSize: job.fileSize,
    uploadDate: job.uploadDate,
    status: job.status,
    pageCount: job.pageCount,
    paperType: job.paperType || 'normal',
    colorMode: job.colorMode,
    copies: job.copies,
    source: job.source,
    paymentStatus: job.paymentStatus || 'UNPAID',
    paymentAmount: job.paymentAmount || 0,
    printPreferences: {
      colorMode: job.colorMode,
      copies: job.copies,
      paperType: job.paperType || 'normal'
    },
  }));
  res.status(200).json(sanitized);
});

// Upload new job
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }

    const metadata = JSON.parse(req.body.metadata);
    const filePath = path.join(UPLOADS_DIR, req.file.filename);

    // Validate magic bytes match the claimed MIME type
    if (!validateMagicBytes(filePath, req.file.mimetype)) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, error: "File content does not match its type" });
    }

    // Get page count for PDF files
    let pageCount = null;
    if (req.file.mimetype === "application/pdf") {
      pageCount = await getPdfPageCount(filePath);
    }

    const newJob = {
      ...metadata,
      serverFileName: req.file.filename,
      uploadDate: new Date().toISOString(),
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      pageCount: pageCount,
    };

    const insertStmt = db.prepare(`
      INSERT INTO jobs (
        id, customerName, phoneNumber, notes, fileName, fileType, 
        fileSize, uploadDate, status, serverFileName, pageCount, 
        colorMode, copies, paperType
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      newJob.id,
      newJob.customerName,
      newJob.phoneNumber,
      newJob.notes,
      newJob.fileName,
      newJob.fileType,
      newJob.fileSize,
      newJob.uploadDate,
      newJob.status,
      newJob.serverFileName,
      newJob.pageCount,
      newJob.printPreferences?.colorMode || 'color',
      newJob.printPreferences?.copies || 1,
      newJob.printPreferences?.paperType || 'normal'
    );

    res.status(200).json({ success: true, job: newJob });
  } catch (err) {
    console.error("❌ Upload Error:", err);
    res.status(400).json({ success: false, error: "Invalid upload metadata" });
  }
});

// Update job file
app.post("/api/jobs/:id/file", requireAdmin, upload.single("file"), async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);

    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }

    // Validate magic bytes match the claimed MIME type
    const newFilePath = path.join(UPLOADS_DIR, req.file.filename);
    if (!validateMagicBytes(newFilePath, req.file.mimetype)) {
      fs.unlinkSync(newFilePath);
      return res.status(400).json({ success: false, error: "File content does not match its type" });
    }

    // Delete old file
    if (job.serverFileName) {
      const oldPath = path.join(UPLOADS_DIR, job.serverFileName);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (e) {
          console.warn("⚠️  Could not delete old file");
        }
      }
    }

    // Get page count for PDF files
    let pageCount = null;
    if (req.file.mimetype === "application/pdf") {
      const filePath = path.join(UPLOADS_DIR, req.file.filename);
      pageCount = await getPdfPageCount(filePath);
    }

    // Update job in DB
    const updateStmt = db.prepare(`
      UPDATE jobs 
      SET serverFileName = ?, fileSize = ?, fileType = ?, pageCount = ? 
      WHERE id = ?
    `);
    updateStmt.run(req.file.filename, req.file.size, req.file.mimetype, pageCount, jobId);

    const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    res.status(200).json({ success: true, job: updatedJob });
  } catch (err) {
    console.error("❌ Update File Error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Update job status
app.put("/api/jobs/:id/status", requireAdmin, (req, res) => {
  const { status } = req.body;
  const jobId = req.params.id;
  
  const result = db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, jobId);

  if (result.changes > 0) {
    const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    res.status(200).json({ success: true, job: updatedJob });
  } else {
    res.status(404).json({ success: false, error: "Job not found" });
  }
});

// Update job print preferences (colorMode, copies)
app.put("/api/jobs/:id/preferences", requireAdmin, (req, res) => {
  const jobId = req.params.id;
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  
  if (!job) {
    return res.status(404).json({ success: false, error: "Job not found" });
  }

  const { colorMode, copies, paperType } = req.body;
  let finalColorMode = job.colorMode;
  let finalCopies = job.copies;
  let finalPaperType = job.paperType || 'normal';

  if (colorMode === "color" || colorMode === "blackWhite") {
    finalColorMode = colorMode;
  }

  const parsedCopies = parseInt(copies, 10);
  if (!isNaN(parsedCopies) && parsedCopies >= 1 && parsedCopies <= 100) {
    finalCopies = parsedCopies;
  }

  if (paperType && typeof paperType === 'string') {
    finalPaperType = paperType;
  }

  db.prepare('UPDATE jobs SET colorMode = ?, copies = ?, paperType = ? WHERE id = ?')
    .run(finalColorMode, finalCopies, finalPaperType, jobId);

  const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  console.log(
    `✏️  Updated preferences for job ${jobId}: ${finalColorMode}, ${finalCopies} cop(ies)`,
  );
  res.status(200).json({ 
    success: true, 
    job: {
      ...updatedJob,
      printPreferences: { colorMode: finalColorMode, copies: finalCopies, paperType: finalPaperType }
    } 
  });
});

// Delete job - accessible to customers (verifies ownership via myIds)
app.delete("/api/jobs/:id", (req, res) => {
  const jobId = req.params.id;
  const { myIds } = req.body || {};

  if (!Array.isArray(myIds) || !myIds.includes(jobId)) {
    return res.status(403).json({ success: false, error: "Not authorized to delete this job" });
  }

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);

  if (job) {
    const filePath = path.join(UPLOADS_DIR, job.serverFileName);

    // Delete physical file
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      console.warn("⚠️  Could not delete physical file");
    }

    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    res.status(200).json({ success: true });
  } else {
    res.status(404).json({ success: false, error: "Job not found" });
  }
});

// Bulk delete jobs
app.post("/api/jobs/bulk/delete", requireAdmin, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: "No IDs provided" });
  }
  const deleteStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const runStmt = db.prepare('DELETE FROM jobs WHERE id = ?');
  const txn = db.transaction((jobIds) => {
    for (const id of jobIds) {
      const job = deleteStmt.get(id);
      if (job) {
        const filePath = path.join(UPLOADS_DIR, job.serverFileName);
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        runStmt.run(id);
      }
    }
  });
  txn(ids);
  res.status(200).json({ success: true, deleted: ids.length });
});

// Bulk status update
app.post("/api/jobs/bulk/status", requireAdmin, (req, res) => {
  const { ids, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: "No IDs provided" });
  }
  const stmt = db.prepare('UPDATE jobs SET status = ? WHERE id = ?');
  const txn = db.transaction((jobIds) => {
    for (const id of jobIds) stmt.run(status, id);
  });
  txn(ids);
  res.status(200).json({ success: true, updated: ids.length });
});

// Update payment status for a single job
app.put("/api/jobs/:id/payment", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { paymentStatus, paymentAmount } = req.body;
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) return res.status(404).json({ success: false, error: "Job not found" });
  const paymentDate = paymentStatus === 'PAID' || paymentStatus === 'PARTIAL' ? new Date().toISOString() : null;
  db.prepare('UPDATE jobs SET paymentStatus = ?, paymentAmount = ?, paymentDate = ? WHERE id = ?').run(paymentStatus, paymentAmount || null, paymentDate, id);
  res.status(200).json({ success: true });
});

// Bulk payment update
app.post("/api/jobs/bulk/payment", requireAdmin, (req, res) => {
  const { ids, paymentStatus } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: "No IDs provided" });
  }
  const paymentDate = paymentStatus === 'PAID' || paymentStatus === 'PARTIAL' ? new Date().toISOString() : null;
  const stmt = db.prepare('UPDATE jobs SET paymentStatus = ?, paymentDate = ? WHERE id = ?');
  const txn = db.transaction((jobIds) => {
    for (const id of jobIds) stmt.run(paymentStatus, paymentDate, id);
  });
  txn(ids);
  res.status(200).json({ success: true, updated: ids.length });
});

// Database backup download
app.get("/api/backup/download", requireAdmin, (req, res) => {
  const dbPath = path.join(__dirname, 'database.sqlite');
  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ success: false, error: "Database not found" });
  }
  res.download(dbPath, `printshop-backup-${new Date().toISOString().slice(0, 10)}.sqlite`);
});

// Database backup restore
app.post("/api/backup/restore", requireAdmin, uploadMemory.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: "No file uploaded" });
  }
  const _dbPath = path.join(__dirname, 'database.sqlite');
  const _backupPath = _dbPath + '.before_restore';
  // Close the current connection before writing
  try { db.close(); } catch (e) {}
  try {
    if (fs.existsSync(_dbPath)) {
      fs.copyFileSync(_dbPath, _backupPath);
    }
    fs.writeFileSync(_dbPath, req.file.buffer);
    reopenDb();
    res.status(200).json({ success: true });
  } catch (e) {
    try { if (fs.existsSync(_backupPath)) fs.copyFileSync(_backupPath, _dbPath); } catch (e2) {}
    try { reopenDb(); } catch (e2) {}
    res.status(500).json({ success: false, error: e.message });
  }
});

// Public file access by job ID — anyone with the job ID can download (must be before the admin catch-all)
app.get("/api/files/public/:id", (req, res) => {
  try {
    const job = db.prepare('SELECT serverFileName, fileName FROM jobs WHERE id = ?').get(req.params.id);
    if (!job || !job.serverFileName) {
      return res.status(404).json({ error: "File not found" });
    }
    const filePath = path.resolve(path.join(UPLOADS_DIR, job.serverFileName));
    if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (fs.existsSync(filePath)) {
      const safeName = job.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      res.set("Content-Disposition", `inline; filename="${safeName}"`);
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: "File not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Download/view file by server file name (admin only — path traversal protected)
app.get(/^\/api\/files\/(.+)/, requireAdmin, (req, res) => {
  const requested = path.normalize(req.params[0]).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.resolve(path.join(UPLOADS_DIR, requested));

  if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// Public logo access (no auth — shown on public upload page)
app.get("/api/logo", (req, res) => {
  const settings = getSettings();
  const filename = settings._logo_filename;
  if (!filename) return res.status(404).json({ error: "No logo" });
  const filePath = path.resolve(path.join(UPLOADS_DIR, filename));
  if (!filePath.startsWith(path.resolve(UPLOADS_DIR)) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Logo not found" });
  }
  res.sendFile(filePath);
});

// Get settings
app.get("/api/settings", (req, res) => {
  const settings = getSettings();
  settings.paperTypes = getPaperTypes();
  res.status(200).json(settings);
});

// Update settings (shop info only; paper types use dedicated endpoints)
app.post("/api/settings", requireAdmin, (req, res) => {
  try {
    if (req.body.shopName !== undefined) {
      updateSetting('shopName', req.body.shopName);
    }
    if (req.body.paperTypes && Array.isArray(req.body.paperTypes)) {
      replaceAllPaperTypes(req.body.paperTypes);
    }
    if (req.body.pricing && typeof req.body.pricing === "object") {
      const currentSettings = getSettings();
      const newPricing = {
        colorPerPage:
          parseFloat(req.body.pricing.colorPerPage) ||
          currentSettings.pricing?.colorPerPage ||
          30.0,
        blackWhitePerPage:
          parseFloat(req.body.pricing.blackWhitePerPage) ||
          currentSettings.pricing?.blackWhitePerPage ||
          15.0,
        glossyPerPage:
          parseFloat(req.body.pricing.glossyPerPage) ||
          currentSettings.pricing?.glossyPerPage ||
          50.0,
        cardboardPerPage:
          parseFloat(req.body.pricing.cardboardPerPage) ||
          currentSettings.pricing?.cardboardPerPage ||
          40.0,
      };
      updateSetting('pricing', newPricing);
    }
    if (req.body.discounts !== undefined) {
      updateSetting('discounts', req.body.discounts);
    }
    if (req.body.phoneNumbers !== undefined) {
      updateSetting('phoneNumbers', req.body.phoneNumbers);
    }
    if (req.body.email !== undefined) {
      updateSetting('email', req.body.email);
    }
    if (req.body.address !== undefined) {
      updateSetting('address', req.body.address);
    }
    if (req.body.workingHours !== undefined) {
      updateSetting('workingHours', req.body.workingHours);
    }
    if (req.body.returnPolicy !== undefined) {
      updateSetting('returnPolicy', req.body.returnPolicy);
    }

    const settings = getSettings();
    settings.paperTypes = getPaperTypes();
    res.status(200).json({ success: true, settings });
  } catch (err) {
    console.error("❌ Settings update error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to update settings" });
  }
});

// Upload logo
app.post("/api/settings/logo", requireAdmin, upload.single("logo"), (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }

    const settings = getSettings();
    // Delete old logo file
    const oldFilename = settings._logo_filename;
    if (oldFilename) {
      const oldPath = path.join(UPLOADS_DIR, oldFilename);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (e) { console.warn("⚠️  Could not delete old logo"); }
      }
    }

    updateSetting('_logo_filename', req.file.filename);
    const logoUrl = `/api/logo`;
    updateSetting('logoUrl', logoUrl);
    res.status(200).json({ success: true, logoUrl });
  } catch (err) {
    console.error("❌ Logo upload error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Password hashing helpers
const SALT_LEN = 16;
const KEY_LEN = 64;

function hashPassword(password) {
  const salt = randomBytes(SALT_LEN);
  const key = scryptSync(password, salt, KEY_LEN);
  return salt.toString("hex") + ":" + key.toString("hex");
}

function verifyHash(password, stored) {
  if (!stored || !stored.includes(":")) {
    return false;
  }
  const [saltHex, keyHex] = stored.split(":");
  const salt = Buffer.from(saltHex, "hex");
  const key = Buffer.from(keyHex, "hex");
  const derivedKey = scryptSync(password, salt, KEY_LEN);
  if (key.length !== derivedKey.length) return false;
  return timingSafeEqual(key, derivedKey);
}

const DEFAULT_PASSWORD = "admin123";
const DEFAULT_HASH = hashPassword(DEFAULT_PASSWORD);

// Verify admin password — returns a session token on success
app.post("/api/auth/verify", rateLimit, (req, res) => {
  const { password } = req.body;
  const settings = getSettings();
  let stored = settings.adminPassword;

  if (!stored) {
    stored = DEFAULT_HASH;
    updateSetting("adminPassword", stored);
  }

  let ok = false;
  if (!stored.includes(":")) {
    ok = password === stored;
    if (ok) {
      const hashed = hashPassword(password);
      updateSetting("adminPassword", hashed);
    }
  } else {
    ok = verifyHash(password, stored);
  }

  if (ok) {
    const token = generateToken();
    res.status(200).json({ success: true, token });
  } else {
    res.status(200).json({ success: false });
  }
});

// Logout — invalidate token
app.post("/api/auth/logout", (req, res) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    adminTokens.delete(auth.slice(7));
    saveTokens(adminTokens);
  }
  res.status(200).json({ success: true });
});

// Change admin password
app.post("/api/settings/password", requireAdmin, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const settings = getSettings();
    let stored = settings.adminPassword;

    if (!stored) {
      stored = DEFAULT_HASH;
      updateSetting("adminPassword", stored);
    }

    let valid;
    if (!stored.includes(":")) {
      valid = currentPassword === stored;
    } else {
      valid = verifyHash(currentPassword, stored);
    }

    if (!valid) {
      return res.status(401).json({ success: false, error: "Current password is incorrect" });
    }
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ success: false, error: "New password must be at least 4 characters" });
    }
    updateSetting("adminPassword", hashPassword(newPassword));
    console.log("🔑 Admin password updated (hashed)");
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Password change error:", err);
    res.status(500).json({ success: false, error: "Failed to change password" });
  }
});

// Get local IP address
app.get("/api/local-ip", (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    let ips = [];

    // Collect all non-internal IPv4 addresses with interface names
    for (const name of Object.keys(interfaces)) {
      const networkInterface = interfaces[name];
      if (networkInterface) {
        for (const interfaceInfo of networkInterface) {
          if (interfaceInfo.family === "IPv4" && !interfaceInfo.internal) {
            ips.push({
              address: interfaceInfo.address,
              interface: name,
              isWifi:
                name.toLowerCase().includes("wi-fi") ||
                name.toLowerCase().includes("wlan"),
              isEthernet:
                name.toLowerCase().includes("ethernet") ||
                name.toLowerCase().includes("eth"),
            });
          }
        }
      }
    }

    let selectedIP = null;

    // Priority 1: Prefer IPs with common gateway patterns (.1.90, .1.100, .0.1, .1.1)
    const commonPatterns = [".1.90", ".1.100", ".0.1", ".1.1"];
    for (const pattern of commonPatterns) {
      const patternIP = ips.find((ip) => ip.address.endsWith(pattern));
      if (patternIP) {
        selectedIP = patternIP.address;
        break;
      }
    }

    // Priority 2: Look for WiFi interfaces (most common for mobile access)
    if (!selectedIP) {
      const wifiIP = ips.find(
        (ip) => ip.isWifi && ip.address.startsWith("192.168."),
      );
      if (wifiIP) {
        selectedIP = wifiIP.address;
      }
    }

    // Priority 3: Look for Ethernet interfaces
    if (!selectedIP) {
      const ethernetIP = ips.find(
        (ip) => ip.isEthernet && ip.address.startsWith("192.168."),
      );
      if (ethernetIP) {
        selectedIP = ethernetIP.address;
      }
    }

    // Priority 4: Any 192.168.x.x address
    if (!selectedIP) {
      const lanIP = ips.find((ip) => ip.address.startsWith("192.168."));
      if (lanIP) {
        selectedIP = lanIP.address;
      }
    }

    // Priority 5: Any non-internal IP
    if (!selectedIP && ips.length > 0) {
      selectedIP = ips[0].address;
    }

    // Fallback to localhost
    if (!selectedIP) {
      selectedIP = "localhost";
    }

    console.log("🌐 Local IP detected");
    res.status(200).json({ ip: selectedIP });
  } catch (err) {
    console.error("❌ Error getting local IP:", err);
    res.status(500).json({ error: "Failed to get local IP" });
  }
});

/**
 * DISCOUNT RULES API
 */

// Get all discount rules
app.get("/api/discount-rules", (req, res) => {
  try {
    const rules = getDiscountRules();
    res.status(200).json(rules);
  } catch (err) {
    console.error("❌ Error fetching discount rules:", err);
    res.status(500).json({ error: "Failed to fetch discount rules" });
  }
});

// Get active discount rules only
app.get("/api/discount-rules/active", (req, res) => {
  try {
    const rules = getActiveDiscountRules();
    res.status(200).json(rules);
  } catch (err) {
    console.error("❌ Error fetching active discount rules:", err);
    res.status(500).json({ error: "Failed to fetch discount rules" });
  }
});

// Create new discount rule
app.post("/api/discount-rules", requireAdmin, (req, res) => {
  try {
    const { id, name, discount_type, discount_value, condition_type, threshold, max_discount_cap, priority, is_active } = req.body;

    if (!id || !name || !discount_type || !condition_type || threshold === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const rule = createDiscountRule({
      id,
      name,
      discount_type,
      discount_value: parseFloat(discount_value) || 0,
      condition_type,
      threshold: parseInt(threshold) || 0,
      max_discount_cap: max_discount_cap ? parseFloat(max_discount_cap) : null,
      priority: parseInt(priority) || 0,
      is_active: is_active !== undefined ? is_active : true,
    });

    res.status(201).json(rule);
  } catch (err) {
    console.error("❌ Error creating discount rule:", err);
    res.status(500).json({ error: "Failed to create discount rule" });
  }
});

// Update discount rule
app.put("/api/discount-rules/:id", requireAdmin, (req, res) => {
  try {
    const ruleId = req.params.id;
    const updates = req.body;

    // Convert numeric fields
    if (updates.discount_value !== undefined) {
      updates.discount_value = parseFloat(updates.discount_value);
    }
    if (updates.threshold !== undefined) {
      updates.threshold = parseInt(updates.threshold);
    }
    if (updates.max_discount_cap !== undefined) {
      updates.max_discount_cap = updates.max_discount_cap ? parseFloat(updates.max_discount_cap) : null;
    }
    if (updates.priority !== undefined) {
      updates.priority = parseInt(updates.priority);
    }

    const rule = updateDiscountRule(ruleId, updates);
    if (!rule) {
      return res.status(404).json({ error: "Discount rule not found" });
    }

    res.status(200).json(rule);
  } catch (err) {
    console.error("❌ Error updating discount rule:", err);
    res.status(500).json({ error: "Failed to update discount rule" });
  }
});

// Delete discount rule
app.delete("/api/discount-rules/:id", requireAdmin, (req, res) => {
  try {
    const ruleId = req.params.id;
    deleteDiscountRule(ruleId);
    res.status(200).json({ success: true, id: ruleId });
  } catch (err) {
    console.error("❌ Error deleting discount rule:", err);
    res.status(500).json({ error: "Failed to delete discount rule" });
  }
});

/**
 * PAPER TYPES API
 */

// Get all paper types
app.get("/api/paper-types", (req, res) => {
  try {
    res.status(200).json(getPaperTypes());
  } catch (err) {
    console.error("❌ Error fetching paper types:", err);
    res.status(500).json({ error: "Failed to fetch paper types" });
  }
});

// Create paper type
app.post("/api/paper-types", requireAdmin, (req, res) => {
  try {
    const { id, name, nameAr, colorPerPage, blackWhitePerPage } = req.body;
    if (!id || !name) {
      return res.status(400).json({ error: "Missing required fields (id, name)" });
    }
    const pt = createPaperType({ id, name, nameAr: nameAr || '', colorPerPage: parseFloat(colorPerPage) || 0, blackWhitePerPage: parseFloat(blackWhitePerPage) || 0 });
    res.status(201).json(pt);
  } catch (err) {
    console.error("❌ Error creating paper type:", err);
    res.status(500).json({ error: "Failed to create paper type" });
  }
});

// Update paper type
app.put("/api/paper-types/:id", requireAdmin, (req, res) => {
  try {
    const pt = updatePaperType(req.params.id, req.body);
    if (!pt) return res.status(404).json({ error: "Paper type not found" });
    res.status(200).json(pt);
  } catch (err) {
    console.error("❌ Error updating paper type:", err);
    res.status(500).json({ error: "Failed to update paper type" });
  }
});

// Delete paper type
app.delete("/api/paper-types/:id", requireAdmin, (req, res) => {
  try {
    deletePaperType(req.params.id);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Error deleting paper type:", err);
    res.status(500).json({ error: "Failed to delete paper type" });
  }
});






/**
 * STATIC FILE SERVING & SPA ROUTING
 */

// Serve public/ assets (notification sound, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Serve static files in production
if (!isDev) {
  app.use(
    express.static(DIST_DIR, {
      maxAge: "1d", // Cache static assets for 1 day
      etag: true,
    }),
  );
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Unhandled Error:", err.stack);
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: isDev ? err.message : "Internal Server Error",
    });
  }
});

// SPA fallback (must be last)
if (!isDev) {
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "API endpoint not found" });
    }
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

/**
 * SERVER STARTUP
 */
const HOST = process.env.HOST || "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log("\n🚀 Server started successfully!");
  console.log(`📦 Environment: ${NODE_ENV}`);
  console.log(`🌐 Server URL: http://${HOST}:${PORT}`);

  if (isDev) {
    console.log(`🔧 Development mode - CORS enabled for http://localhost:5173`);
    console.log(`💡 Frontend should run on port 5173 (Vite default)`);
  } else {
    console.log(`📁 Serving static files from: ${DIST_DIR}`);
  }

  console.log(`📂 Uploads directory: ${UPLOADS_DIR.replace(__dirname, '.')}`);
  console.log(`💾 SQLite database: database.sqlite\n`);


});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n⏹️  SIGTERM received, shutting down gracefully...");
  db.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\n⏹️  SIGINT received, shutting down gracefully...");
  db.close();
  process.exit(0);
});
