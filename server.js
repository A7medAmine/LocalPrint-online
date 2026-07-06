import 'dotenv/config';
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { PDFDocument } from "pdf-lib";
import { randomBytes } from "crypto";

import supabase, {
  getSettings,
  updateSetting,
  getPaperTypes,
  replaceAllPaperTypes,
  getDiscountRules,
  getActiveDiscountRules,
} from './db.js';

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
  if (!signatures) return true;
  const buf = Buffer.alloc(16);
  const fd = fs.openSync(filePath, "r");
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  return signatures.some(sig =>
    sig.every((byte, i) => buf[i] === byte)
  );
}

// ── Shop token middleware ──
function requireShopToken(req, res, next) {
  const auth = req.headers.authorization;
  const expectedToken = process.env.SHOP_API_TOKEN;
  if (!expectedToken) {
    return res.status(500).json({ error: 'SHOP_API_TOKEN not configured on server' });
  }
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Rate limiter (in-memory, per-IP) ──
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 5;

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

const NODE_ENV = process.env.NODE_ENV || "development";
const isDev = NODE_ENV === "development";
const PORT = process.env.PORT || (isDev ? 3001 : 3000);

const DIST_DIR = path.join(__dirname, "dist");
const UPLOADS_DIR = path.join(__dirname, "uploads");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (isDev) {
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "http://localhost:5000");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });
}

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DIST_DIR) && !isDev) {
  console.warn("⚠️  DIST_DIR does not exist. Run build first!");
}

/**
 * PDF Page Count Helper
 */
const getPdfPageCount = async (filePath) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(fileBuffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const pageCount = pdfDoc.getPageCount();
    console.log(`📄 PDF page count for ${path.basename(filePath)}: ${pageCount}`);
    return pageCount;
  } catch (err) {
    console.error(`❌ Error reading PDF page count for ${path.basename(filePath)}:`, err.message);
    return null;
  }
};

// Backfill missing pageCount for existing PDF orders (runs once at startup)
const backfillPageCounts = async () => {
  const { data: pdfOrdersMissingCount, error } = await supabase
    .from('orders')
    .select('*')
    .eq('fileType', 'application/pdf')
    .or('pageCount.is.null,pageCount.eq.0');

  if (error) { console.error("❌ Backfill query error:", error); return; }
  if (!pdfOrdersMissingCount || pdfOrdersMissingCount.length === 0) {
    console.log("✅ All PDF orders already have page counts.");
    return;
  }

  console.log(`📚 Backfilling page counts for ${pdfOrdersMissingCount.length} PDF order(s)...`);

  for (const order of pdfOrdersMissingCount) {
    if (!order.serverFileName) {
      console.warn(`  ⚠️  Order ${order.id} has no serverFileName — skipping.`);
      continue;
    }
    const filePath = path.join(UPLOADS_DIR, order.serverFileName);
    if (fs.existsSync(filePath)) {
      const count = await getPdfPageCount(filePath);
      if (count !== null) {
        await supabase.from('orders').update({ pageCount: count }).eq('id', order.id);
        console.log(`  ✅ ${order.fileName}: ${count} page(s)`);
      } else {
        console.warn(`  ⚠️  Could not count pages for ${order.fileName}`);
      }
    } else {
      console.warn(`  ⚠️  File not found for order ${order.id}`);
    }
  }
};

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
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed. Allowed: PDF, DOCX, XLSX, JPEG, PNG, TIFF`));
    }
  },
});

/**
 * PUBLIC API ROUTES
 */

// Favicon
app.get("/favicon.ico", (req, res) => {
  res.type("image/svg+xml").send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#2563eb"/><text x="32" y="44" font-size="36" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="bold">P</text></svg>`);
});

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", environment: NODE_ENV, timestamp: new Date().toISOString() });
});

// Public upload endpoint (rate-limited)
app.post("/api/upload", rateLimit, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    const metadata = JSON.parse(req.body.metadata);
    const filePath = path.join(UPLOADS_DIR, req.file.filename);

    if (!validateMagicBytes(filePath, req.file.mimetype)) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, error: "File content does not match its type" });
    }

    let pageCount = null;
    if (req.file.mimetype === "application/pdf") {
      pageCount = await getPdfPageCount(filePath);
    }

    const newOrder = {
      id: metadata.id,
      customerName: metadata.customerName || '',
      phoneNumber: metadata.phoneNumber || '',
      notes: metadata.notes || '',
      fileName: metadata.fileName || req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      uploadDate: new Date().toISOString(),
      status: 'PENDING',
      serverFileName: req.file.filename,
      pageCount: pageCount,
      colorMode: metadata.printPreferences?.colorMode || 'color',
      copies: metadata.printPreferences?.copies || 1,
      paperType: metadata.printPreferences?.paperType || 'normal',
      source: 'upload',
      shopSyncStatus: 'pending',
    };

    const { error } = await supabase.from('orders').insert(newOrder);
    if (error) throw error;

    res.status(200).json({ success: true, job: newOrder });
  } catch (err) {
    console.error("❌ Upload Error:", err);
    res.status(400).json({ success: false, error: "Invalid upload metadata" });
  }
});

// Public order query — lookup by ID array for "my recent uploads"
app.post("/api/orders/query", async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(200).json([]);
  }
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .in('id', ids)
    .order('uploadDate', { ascending: false });
  if (error) throw error;

  const sanitized = (orders || []).map(order => ({
    id: order.id,
    fileName: order.fileName,
    fileType: order.fileType,
    fileSize: order.fileSize,
    uploadDate: order.uploadDate,
    status: order.status,
    pageCount: order.pageCount,
    paperType: order.paperType || 'normal',
    colorMode: order.colorMode,
    copies: order.copies,
    source: order.source,
    printPreferences: {
      colorMode: order.colorMode,
      copies: order.copies,
      paperType: order.paperType || 'normal'
    },
  }));
  res.status(200).json(sanitized);
});

// Delete order (ownership verified via myIds)
app.delete("/api/orders/:id", async (req, res) => {
  const orderId = req.params.id;
  const { myIds } = req.body || {};

  if (!Array.isArray(myIds) || !myIds.includes(orderId)) {
    return res.status(403).json({ success: false, error: "Not authorized to delete this order" });
  }

  const { data: order, error } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (error || !order) {
    return res.status(404).json({ success: false, error: "Order not found" });
  }

  const filePath = path.join(UPLOADS_DIR, order.serverFileName);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { console.warn("⚠️  Could not delete physical file"); }

  await supabase.from('orders').delete().eq('id', orderId);
  res.status(200).json({ success: true });
});

// Public file access by order ID
app.get("/api/files/public/:id", async (req, res) => {
  try {
    const { data: order, error } = await supabase.from('orders').select('serverFileName, fileName').eq('id', req.params.id).single();
    if (error || !order || !order.serverFileName) {
      return res.status(404).json({ error: "File not found" });
    }
    const filePath = path.resolve(path.join(UPLOADS_DIR, order.serverFileName));
    if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (fs.existsSync(filePath)) {
      const safeName = order.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      res.set("Content-Disposition", `inline; filename="${safeName}"`);
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: "File not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Public logo access
app.get("/api/logo", async (req, res) => {
  const settings = await getSettings();
  const filename = settings._logo_filename;
  if (!filename) return res.status(404).json({ error: "No logo" });
  const filePath = path.resolve(path.join(UPLOADS_DIR, filename));
  if (!filePath.startsWith(path.resolve(UPLOADS_DIR)) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Logo not found" });
  }
  res.sendFile(filePath);
});

// Get settings (public — used by price calculator)
app.get("/api/settings", async (req, res) => {
  const settings = await getSettings();
  settings.paperTypes = await getPaperTypes();
  res.status(200).json(settings);
});

// Get paper types (public)
app.get("/api/paper-types", async (req, res) => {
  try {
    res.status(200).json(await getPaperTypes());
  } catch (err) {
    console.error("❌ Error fetching paper types:", err);
    res.status(500).json({ error: "Failed to fetch paper types" });
  }
});

// Get discount rules (public reads)
app.get("/api/discount-rules", async (req, res) => {
  try {
    const rules = await getDiscountRules();
    res.status(200).json(rules);
  } catch (err) {
    console.error("❌ Error fetching discount rules:", err);
    res.status(500).json({ error: "Failed to fetch discount rules" });
  }
});

app.get("/api/discount-rules/active", async (req, res) => {
  try {
    const rules = await getActiveDiscountRules();
    res.status(200).json(rules);
  } catch (err) {
    console.error("❌ Error fetching active discount rules:", err);
    res.status(500).json({ error: "Failed to fetch active discount rules" });
  }
});

/**
 * SHOP-SYNC API (authenticated with SHOP_API_TOKEN)
 */

// Get pending orders (not yet claimed by shop)
app.get("/api/shop/pending", requireShopToken, async (req, res) => {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .eq('shopSyncStatus', 'pending')
    .order('uploadDate', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(orders || []);
});

// Download file for a specific order
app.get("/api/shop/file/:orderId", requireShopToken, async (req, res) => {
  const { data: order, error } = await supabase.from('orders').select('*').eq('id', req.params.orderId).single();
  if (error || !order) return res.status(404).json({ error: "Order not found" });
  if (!order.serverFileName) return res.status(404).json({ error: "No file for this order" });

  const filePath = path.resolve(path.join(UPLOADS_DIR, order.serverFileName));
  if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) return res.status(403).json({ error: "Forbidden" });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found on disk" });

  const safeName = order.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  res.set("Content-Disposition", `attachment; filename="${safeName}"`);
  res.sendFile(filePath);
});

// Acknowledge/claim orders (shop has picked them up)
app.post("/api/shop/ack", requireShopToken, async (req, res) => {
  const { orderIds } = req.body;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ error: "orderIds array is required" });
  }
  const { error } = await supabase
    .from('orders')
    .update({ shopSyncStatus: 'claimed' })
    .in('id', orderIds)
    .eq('shopSyncStatus', 'pending');
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ success: true, claimed: orderIds.length });
});

// Update order status (e.g., "PRINTED") — pushed from shop
app.post("/api/shop/status", requireShopToken, async (req, res) => {
  const { orderId, status } = req.body;
  if (!orderId || !status) {
    return res.status(400).json({ error: "orderId and status are required" });
  }
  const { error } = await supabase.from('orders').update({ status }).eq('id', orderId);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ success: true });
});

// Sync settings/pricing/paper types/discount rules from shop
app.post("/api/shop/settings-sync", requireShopToken, async (req, res) => {
  try {
    const { pricing, paperTypes, discountRules } = req.body;

    if (pricing && typeof pricing === 'object') {
      await updateSetting('pricing', {
        colorPerPage: parseFloat(pricing.colorPerPage) || 30.0,
        blackWhitePerPage: parseFloat(pricing.blackWhitePerPage) || 15.0,
        glossyPerPage: parseFloat(pricing.glossyPerPage) || 50.0,
        cardboardPerPage: parseFloat(pricing.cardboardPerPage) || 40.0,
      });
    }
    if (pricing?.shopName) {
      await updateSetting('shopName', pricing.shopName);
    }
    if (pricing?.phoneNumbers) {
      await updateSetting('phoneNumbers', pricing.phoneNumbers);
    }
    if (pricing?.email) {
      await updateSetting('email', pricing.email);
    }
    if (pricing?.address) {
      await updateSetting('address', pricing.address);
    }
    if (pricing?.workingHours) {
      await updateSetting('workingHours', pricing.workingHours);
    }
    if (pricing?.returnPolicy) {
      await updateSetting('returnPolicy', pricing.returnPolicy);
    }
    if (pricing?.logoUrl) {
      await updateSetting('logoUrl', pricing.logoUrl);
    }

    if (Array.isArray(paperTypes)) {
      await replaceAllPaperTypes(paperTypes);
    }

    if (Array.isArray(discountRules)) {
      const { error: delErr } = await supabase.from('discount_rules').delete().neq('id', 'nonexistent');
      if (delErr && delErr.code !== 'PGRST116') throw delErr;
      if (discountRules.length > 0) {
        const { error: insErr } = await supabase.from('discount_rules').insert(
          discountRules.map(r => ({
            ...r,
            is_active: r.is_active ? 1 : 0,
            created_at: r.created_at || new Date().toISOString(),
          }))
        );
        if (insErr) throw insErr;
      }
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Settings sync error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * CLEANUP JOB — delete claimed orders older than 7 days
 */
const cleanupOldOrders = async () => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: oldOrders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('shopSyncStatus', 'claimed')
      .lt('uploadDate', sevenDaysAgo);

    if (error) { console.error("❌ Cleanup query error:", error); return; }
    if (!oldOrders || oldOrders.length === 0) return;

    for (const order of oldOrders) {
      if (order.serverFileName) {
        const filePath = path.join(UPLOADS_DIR, order.serverFileName);
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
      }
      await supabase.from('orders').delete().eq('id', order.id);
    }
    console.log(`🧹 Cleaned up ${oldOrders.length} old claimed orders`);
  } catch (err) {
    console.error("❌ Cleanup error:", err);
  }
};

// Run cleanup daily
setInterval(cleanupOldOrders, 24 * 60 * 60 * 1000);
// Also run once at startup
setTimeout(cleanupOldOrders, 60_000);

/**
 * STATIC FILE SERVING & SPA ROUTING
 */
app.use(express.static(path.join(__dirname, 'public')));

if (!isDev) {
  app.use(express.static(DIST_DIR, { maxAge: "1d", etag: true }));
}

app.use((err, req, res, next) => {
  console.error("❌ Unhandled Error:", err.stack);
  if (!res.headersSent) {
    res.status(500).json({ success: false, error: isDev ? err.message : "Internal Server Error" });
  }
});

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
  console.log("\n🚀 LocalPrint Cloud started!");
  console.log(`📦 Environment: ${NODE_ENV}`);
  console.log(`🌐 Server URL: http://${HOST}:${PORT}`);
  if (isDev) {
    console.log(`🔧 Dev mode - CORS enabled for http://localhost:5000`);
  }
  console.log(`📂 Uploads directory: ${UPLOADS_DIR.replace(__dirname, '.')}`);
  console.log(`🗄️  Database: Supabase\n`);
});
