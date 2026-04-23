import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 10000;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'America/Sao_Paulo';
const DEFAULT_MESSAGE_TEMPLATE = process.env.DEFAULT_MESSAGE_TEMPLATE || '🎉 Feliz aniversário, {nick}!';
const RECENT_ALERT_SECONDS = Number(process.env.RECENT_ALERT_SECONDS || 20);

const app = express();
app.use(cors());
app.use(express.json());

const dbPath = path.join(__dirname, 'data', 'db.json');

function loadDb() {
  try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
  catch { return { registrations: [], manualAlerts: [] }; }
}
function saveDb(db) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
}
function uid(prefix='id') { return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`; }
function normalizeChannel(value='') { return String(value).trim().toLowerCase().replace(/^@/, ''); }
function normalizeUser(value='') { return String(value).trim(); }
function parseDateBR(dateStr='') {
  const m = String(dateStr).trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day, month, normalized: `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}` };
}
function parseTimeStr(timeStr='') {
  const m = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute, normalized: `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}` };
}
function nowInTimezone(timezone = DEFAULT_TIMEZONE) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(now);
  const get = (t) => parts.find(p => p.type === t)?.value;
  return {
    year: Number(get('year')), month: Number(get('month')), day: Number(get('day')),
    hour: Number(get('hour')), minute: Number(get('minute')), second: Number(get('second')),
    iso: now.toISOString()
  };
}
function buildMessage(template, vars) {
  return String(template || DEFAULT_MESSAGE_TEMPLATE)
    .replaceAll('{nick}', vars.nick || '')
    .replaceAll('{channel}', vars.channel || '')
    .replaceAll('{date}', vars.date || '')
    .replaceAll('{time}', vars.time || '');
}
function cleanupDb(db) {
  const cutoff = Date.now() - (RECENT_ALERT_SECONDS + 120) * 1000;
  db.manualAlerts = (db.manualAlerts || []).filter(a => new Date(a.createdAt).getTime() >= cutoff);
}

app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'Birthday Live Alert', appBaseUrl: APP_BASE_URL, timezone: DEFAULT_TIMEZONE,
    routes: {
      register: '/api/register?channel=SEU_CANAL&user=SEU_USER&date=DD/MM&time=HH:MM',
      testAlert: '/api/test-alert?channel=SEU_CANAL&user=SEU_USER',
      overlayAlerts: '/api/overlay/alerts?channel=SEU_CANAL&timezone=America/Sao_Paulo'
    }});
});

app.get('/api/register', (req, res) => {
  const channel = normalizeChannel(req.query.channel);
  const username = normalizeUser(req.query.user);
  const date = parseDateBR(req.query.date);
  const time = parseTimeStr(req.query.time);
  const avatarUrl = String(req.query.avatarUrl || '').trim();
  const messageTemplate = String(req.query.message || '').trim() || DEFAULT_MESSAGE_TEMPLATE;
  if (!channel) return res.status(400).json({ ok: false, error: 'channel obrigatório' });
  if (!username) return res.status(400).json({ ok: false, error: 'user obrigatório' });
  if (!date) return res.status(400).json({ ok: false, error: 'date inválida, use DD/MM' });
  if (!time) return res.status(400).json({ ok: false, error: 'time inválida, use HH:MM' });
  const db = loadDb(); cleanupDb(db);
  const item = { id: uid('reg'), channel, username, date: date.normalized, time: time.normalized, avatarUrl, messageTemplate, createdAt: new Date().toISOString() };
  db.registrations.push(item); saveDb(db);
  return res.json({ ok: true, saved: item, chatMessage: `Aniversário de ${username} salvo para ${date.normalized} às ${time.normalized}.` });
});

app.get('/api/test-alert', (req, res) => {
  const channel = normalizeChannel(req.query.channel);
  const username = normalizeUser(req.query.user || 'testeviewer');
  if (!channel) return res.status(400).json({ ok: false, error: 'channel obrigatório' });
  const db = loadDb(); cleanupDb(db);
  const nowLocal = nowInTimezone(String(req.query.timezone || DEFAULT_TIMEZONE));
  const alert = {
    id: uid('manual'), channel, username,
    date: `${String(nowLocal.day).padStart(2, '0')}/${String(nowLocal.month).padStart(2, '0')}`,
    time: `${String(nowLocal.hour).padStart(2, '0')}:${String(nowLocal.minute).padStart(2, '0')}`,
    avatarUrl: String(req.query.avatarUrl || '').trim(),
    message: buildMessage(DEFAULT_MESSAGE_TEMPLATE, {
      nick: username, channel,
      date: `${String(nowLocal.day).padStart(2, '0')}/${String(nowLocal.month).padStart(2, '0')}`,
      time: `${String(nowLocal.hour).padStart(2, '0')}:${String(nowLocal.minute).padStart(2, '0')}`,
    }),
    createdAt: new Date().toISOString()
  };
  db.manualAlerts.push(alert); saveDb(db);
  res.json({ ok: true, created: alert });
});

app.get('/api/overlay/alerts', (req, res) => {
  const channel = normalizeChannel(req.query.channel);
  const timezone = String(req.query.timezone || DEFAULT_TIMEZONE);
  if (!channel) return res.status(400).json({ ok: false, error: 'channel obrigatório' });
  const db = loadDb(); cleanupDb(db); saveDb(db);
  const nowLocal = nowInTimezone(timezone);
  const due = [];
  for (const a of db.manualAlerts || []) {
    if (normalizeChannel(a.channel) !== channel) continue;
    const ageSec = (Date.now() - new Date(a.createdAt).getTime()) / 1000;
    if (ageSec <= RECENT_ALERT_SECONDS) {
      due.push({ id: a.id, channel, username: a.username, date: a.date, time: a.time, avatarUrl: a.avatarUrl || '', message: a.message });
    }
  }
  for (const reg of db.registrations || []) {
    if (normalizeChannel(reg.channel) !== channel) continue;
    const d = parseDateBR(reg.date), t = parseTimeStr(reg.time);
    if (!d || !t) continue;
    if (d.day !== nowLocal.day || d.month !== nowLocal.month) continue;
    if (t.hour !== nowLocal.hour || t.minute !== nowLocal.minute) continue;
    const occurrenceId = `${reg.id}_${nowLocal.year}_${String(nowLocal.month).padStart(2,'0')}_${String(nowLocal.day).padStart(2,'0')}_${String(nowLocal.hour).padStart(2,'0')}${String(nowLocal.minute).padStart(2,'0')}`;
    due.push({
      id: occurrenceId, channel, username: reg.username, date: reg.date, time: reg.time, avatarUrl: reg.avatarUrl || '',
      message: buildMessage(reg.messageTemplate, { nick: reg.username, channel, date: reg.date, time: reg.time })
    });
  }
  res.json({ ok: true, serverTime: nowLocal.iso, timezone, channel, due });
});

app.listen(PORT, () => { console.log(`Birthday Live Alert rodando em ${APP_BASE_URL}`); });
