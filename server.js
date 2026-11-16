// fuks e.V. – Antwortkarten-Eingang
// Nimmt Fotos der Antwortkarte entgegen, legt sie ab und (optional) mailt sie an fuks.
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8090);
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'data', 'antwortkarten');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MAX_MB = Number(process.env.MAX_MB || 20);
const MAIL_TO = process.env.MAIL_TO || 'kontakt@fuks.org';

// Ablage anlegen und sofort prüfen – ein falsch berechtigtes Volume soll beim
// Start auffallen und nicht erst beim ersten Foto des Kunden.
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.accessSync(UPLOAD_DIR, fs.constants.W_OK);
  console.log(`[start] Ablage: ${UPLOAD_DIR} (beschreibbar)`);
} catch (err) {
  console.error(`[start] FEHLER: ${UPLOAD_DIR} ist nicht beschreibbar – ${err.message}`);
}
const INDEX = path.join(UPLOAD_DIR, 'index.jsonl');

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/jpg']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().slice(0, 6);
    cb(null, `antwortkarte_${stamp}_${crypto.randomBytes(3).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});

// Sehr einfaches Bremsschloss: max. 12 Uploads pro IP und Stunde.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (list.length >= 12) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

async function mailToFuks({ file, firma, name, email, ip }) {
  if (!process.env.SMTP_HOST) return { sent: false, reason: 'SMTP nicht konfiguriert' };
  try {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '') === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'antwortkarte@fuks.org',
      to: MAIL_TO,
      replyTo: email || undefined,
      subject: `Antwortkarte${firma ? ' – ' + firma : ''}`,
      text: [
        'Neue Antwortkarte über die Webseite.',
        '',
        `Firma: ${firma || '-'}`,
        `Name:  ${name || '-'}`,
        `Mail:  ${email || '-'}`,
        `Datei: ${path.basename(file.path)}`,
        `Zeit:  ${new Date().toISOString()}`,
      ].join('\n'),
      attachments: [{ filename: path.basename(file.path), path: file.path }],
    });
    return { sent: true };
  } catch (err) {
    console.error('[mail]', err.message);
    return { sent: false, reason: err.message };
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: 0, etag: true }));

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

app.post('/api/antwortkarte', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unbekannt';
  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Zu viele Sendungen. Bitte später erneut versuchen.' });
  }

  upload.single('foto')(req, res, async (err) => {
    if (err) {
      console.error('[upload]', err.code || '', err.message);
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `Das Bild ist größer als ${MAX_MB} MB.`
        : 'Das Bild konnte nicht angenommen werden.';
      return res.status(400).json({ ok: false, error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Es kam kein Bild an. Bitte erneut versuchen.' });
    }

    const firma = String(req.body.firma || '').trim().slice(0, 160);
    const name = String(req.body.name || '').trim().slice(0, 160);
    const email = String(req.body.email || '').trim().slice(0, 200);
    if (!firma) {
      fs.rm(req.file.path, { force: true }, () => {});
      return res.status(400).json({ ok: false, error: 'Bitte den Firmennamen angeben.' });
    }

    const mail = await mailToFuks({ file: req.file, firma, name, email, ip });
    const entry = {
      zeit: new Date().toISOString(),
      firma,
      name,
      email,
      ip,
      datei: path.basename(req.file.path),
      bytes: req.file.size,
      per_mail: mail.sent,
      mail_fehler: mail.sent ? null : mail.reason,
    };
    try {
      fs.appendFileSync(INDEX, JSON.stringify(entry) + '\n');
    } catch (e) {
      console.error('[index]', e.message);
    }
    console.log(`[eingang] ${entry.datei} von ${firma}${mail.sent ? ' (gemailt)' : ''}`);
    res.json({ ok: true, datei: entry.datei, gemailt: mail.sent });
  });
});

// Interne Übersicht. Ohne gesetztes ADMIN_TOKEN nicht vorhanden.
app.get('/intern', (req, res) => {
  if (!ADMIN_TOKEN || req.query.token !== ADMIN_TOKEN) return res.status(404).type('text').send('Nichts hier.');
  let rows = [];
  try {
    rows = fs.readFileSync(INDEX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { /* noch nichts da */ }
  rows.reverse();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Antwortkarten</title>
<style>body{font:15px/1.5 Montserrat,system-ui,sans-serif;margin:32px;background:#fff;color:#000}
h1{font-size:22px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e6e6e6;padding:8px;text-align:left;vertical-align:top}
th{background:#f2f2f2}a{color:#EB5E28}</style>
<h1>Antwortkarten – ${rows.length}</h1><table><tr><th>Zeit</th><th>Firma</th><th>Name</th><th>Mail</th><th>Datei</th></tr>
${rows.map((r) => `<tr><td>${esc(r.zeit)}</td><td>${esc(r.firma)}</td><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td><a href="/uploads/${esc(r.datei)}">${esc(r.datei)}</a></td></tr>`).join('')}
</table>`);
});

app.use('/uploads', express.static(UPLOAD_DIR, { index: false, dotfiles: 'deny' }));

app.use((_req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`fuks Antwortkarte läuft auf http://127.0.0.1:${PORT}`));
