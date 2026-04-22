import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'America/Sao_Paulo';
const ALERT_WINDOW_MINUTES = Number(process.env.ALERT_WINDOW_MINUTES || 2);
const DEFAULT_MESSAGE_TEMPLATE = process.env.DEFAULT_MESSAGE_TEMPLATE || '🎉 Feliz aniversário, {nick}!';
const DEFAULT_AVATAR_URL = process.env.DEFAULT_AVATAR_URL || '';
const DB_FILE = path.join(__dirname, 'data.json');
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let twitchAppTokenCache = { token: '', expiresAt: 0 };

function ensureDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ birthdays: [], firedAlerts: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function normalizeUsername(username) {
  return String(username || '').trim().replace(/^@+/, '').toLowerCase();
}

function normalizeChannel(channel) {
  return String(channel || '').trim().replace(/^@+/, '').toLowerCase();
}

function parseDate(input) {
  const value = String(input || '').trim();
  const match = value.match(/^(\d{1,2})[\/-](\d{1,2})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const maxDay = new Date(2024, month, 0).getDate();
  if (day < 1 || day > maxDay) return null;
  return { day, month };
}

function parseTime(input) {
  const value = String(input || '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function isValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getDatePartsInTimezone(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function minutesSinceMidnight(hour, minute) {
  return hour * 60 + minute;
}

function clipTemplate(input) {
  const value = String(input || '').trim();
  if (!value) return DEFAULT_MESSAGE_TEMPLATE;
  return value.slice(0, 220);
}

function fillTemplate(template, row) {
  return clipTemplate(template)
    .replaceAll('{nick}', row.username)
    .replaceAll('{user}', row.username)
    .replaceAll('{channel}', row.channel || '')
    .replaceAll('{date}', `${String(row.day).padStart(2, '0')}/${String(row.month).padStart(2, '0')}`)
    .replaceAll('{time}', `${String(row.hour).padStart(2, '0')}:${String(row.minute).padStart(2, '0')}`);
}

function sanitizeRecord(row) {
  return {
    id: row.id,
    channel: row.channel,
    username: row.username,
    date: `${String(row.day).padStart(2, '0')}/${String(row.month).padStart(2, '0')}`,
    time: `${String(row.hour).padStart(2, '0')}:${String(row.minute).padStart(2, '0')}`,
    timezone: row.timezone,
    messageTemplate: row.messageTemplate || DEFAULT_MESSAGE_TEMPLATE,
    avatarUrl: row.avatarUrl || DEFAULT_AVATAR_URL,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function buildChatResponse(channel, username, date, time) {
  const channelPrefix = channel ? ` no canal @${channel}` : '';
  return `@${username} aniversário salvo${channelPrefix} para ${date} às ${time}.`;
}

async function getTwitchAppToken() {
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) return '';
  if (twitchAppTokenCache.token && Date.now() < twitchAppTokenCache.expiresAt - 60_000) {
    return twitchAppTokenCache.token;
  }

  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    client_secret: TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials'
  });

  const response = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, { method: 'POST' });
  if (!response.ok) throw new Error(`Twitch token error: ${response.status}`);
  const data = await response.json();
  twitchAppTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + ((Number(data.expires_in) || 0) * 1000)
  };
  return twitchAppTokenCache.token;
}

async function getTwitchProfileImage(login) {
  const normalized = normalizeUsername(login);
  if (!normalized || !TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) return '';

  try {
    const token = await getTwitchAppToken();
    if (!token) return '';
    const response = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(normalized)}`, {
      headers: {
        'Client-Id': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });
    if (!response.ok) return '';
    const data = await response.json();
    return data?.data?.[0]?.profile_image_url || '';
  } catch {
    return '';
  }
}

async function upsertBirthday({ channel, username, month, day, hour, minute, timezone, messageTemplate, avatarUrl, resolveAvatar }) {
  const db = readDb();
  const now = new Date().toISOString();
  const existing = db.birthdays.find(item => item.channel === channel && item.username === username);
  const resolvedAvatar = avatarUrl || (resolveAvatar ? await getTwitchProfileImage(username) : '') || DEFAULT_AVATAR_URL;

  if (existing) {
    existing.month = month;
    existing.day = day;
    existing.hour = hour;
    existing.minute = minute;
    existing.timezone = timezone;
    existing.messageTemplate = messageTemplate;
    existing.avatarUrl = resolvedAvatar;
    existing.updatedAt = now;
  } else {
    db.birthdays.push({
      id: crypto.randomUUID(),
      channel,
      username,
      month,
      day,
      hour,
      minute,
      timezone,
      messageTemplate,
      avatarUrl: resolvedAvatar,
      createdAt: now,
      updatedAt: now
    });
  }

  writeDb(db);
  return db.birthdays.find(item => item.channel === channel && item.username === username);
}

function deleteBirthday(channel, username) {
  const db = readDb();
  db.birthdays = db.birthdays.filter(item => !(item.channel === channel && item.username === username));
  db.firedAlerts = db.firedAlerts.filter(item => !(item.channel === channel && item.username === username));
  writeDb(db);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, appBaseUrl: APP_BASE_URL });
});

app.get('/api/register', async (req, res) => {
  const channel = normalizeChannel(req.query.channel || req.query.broadcaster || req.query.streamer);
  const username = normalizeUsername(req.query.user || req.query.username || req.query.nick);
  const date = parseDate(req.query.date || req.query.data);
  const time = parseTime(req.query.time || req.query.hora);
  const timezone = String(req.query.timezone || DEFAULT_TIMEZONE).trim();
  const messageTemplate = clipTemplate(req.query.message || req.query.template || DEFAULT_MESSAGE_TEMPLATE);
  const avatarUrl = String(req.query.avatarUrl || '').trim();
  const resolveAvatar = String(req.query.resolveAvatar || 'true').toLowerCase() !== 'false';

  if (!channel) return res.status(400).send('Faltou o canal.');
  if (!username) return res.status(400).send('Uso: !niver DD/MM HH:MM');
  if (!date) return res.status(400).send('Data inválida. Use DD/MM, ex: 12/08');
  if (!time) return res.status(400).send('Hora inválida. Use HH:MM, ex: 09:30');
  if (!isValidTimezone(timezone)) return res.status(400).send('Timezone inválida.');

  await upsertBirthday({
    channel,
    username,
    month: date.month,
    day: date.day,
    hour: time.hour,
    minute: time.minute,
    timezone,
    messageTemplate,
    avatarUrl,
    resolveAvatar
  });

  return res.send(buildChatResponse(channel, username, `${String(date.day).padStart(2, '0')}/${String(date.month).padStart(2, '0')}`, `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`));
});

app.get('/api/birthdays', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  const channel = normalizeChannel(req.query.channel);
  const db = readDb();
  const items = db.birthdays
    .filter(item => !channel || item.channel === channel)
    .slice()
    .sort((a, b) => (a.channel.localeCompare(b.channel) || a.username.localeCompare(b.username)))
    .map(sanitizeRecord);
  res.json({ items });
});

app.post('/api/birthdays', async (req, res) => {
  if (req.query.key !== ADMIN_KEY && req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const channel = normalizeChannel(req.body.channel);
  const username = normalizeUsername(req.body.username);
  const date = parseDate(req.body.date);
  const time = parseTime(req.body.time);
  const timezone = String(req.body.timezone || DEFAULT_TIMEZONE).trim();
  const messageTemplate = clipTemplate(req.body.messageTemplate || DEFAULT_MESSAGE_TEMPLATE);
  const avatarUrl = String(req.body.avatarUrl || '').trim();
  const resolveAvatar = String(req.body.resolveAvatar || 'true').toLowerCase() !== 'false';

  if (!channel || !username || !date || !time || !isValidTimezone(timezone)) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  const saved = await upsertBirthday({
    channel,
    username,
    month: date.month,
    day: date.day,
    hour: time.hour,
    minute: time.minute,
    timezone,
    messageTemplate,
    avatarUrl,
    resolveAvatar
  });
  res.json({ ok: true, item: sanitizeRecord(saved) });
});

app.delete('/api/birthdays/:channel/:username', (req, res) => {
  if (req.query.key !== ADMIN_KEY && req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  deleteBirthday(normalizeChannel(req.params.channel), normalizeUsername(req.params.username));
  res.json({ ok: true });
});

app.get('/api/overlay/alerts', (req, res) => {
  const channel = normalizeChannel(req.query.channel);
  const timezone = String(req.query.timezone || DEFAULT_TIMEZONE).trim();
  const dryRun = String(req.query.dryRun || '').toLowerCase() === 'true';
  if (!channel) return res.status(400).json({ error: 'missing_channel' });
  if (!isValidTimezone(timezone)) {
    return res.status(400).json({ error: 'invalid_timezone' });
  }

  const now = new Date();
  const parts = getDatePartsInTimezone(now, timezone);
  const nowMinutes = minutesSinceMidnight(parts.hour, parts.minute);
  const windowStart = nowMinutes - ALERT_WINDOW_MINUTES;
  const db = readDb();
  const due = [];

  for (const row of db.birthdays.filter(item => item.channel === channel && item.month === parts.month && item.day === parts.day)) {
    const targetMinutes = minutesSinceMidnight(row.hour, row.minute);
    const fired = db.firedAlerts.some(item => item.channel === row.channel && item.username === row.username && item.year === parts.year);
    const insideWindow = targetMinutes <= nowMinutes && targetMinutes >= windowStart;
    if (!fired && insideWindow) {
      due.push({
        id: row.id,
        channel: row.channel,
        username: row.username,
        usernameDisplay: row.username,
        date: `${String(row.day).padStart(2, '0')}/${String(row.month).padStart(2, '0')}`,
        time: `${String(row.hour).padStart(2, '0')}:${String(row.minute).padStart(2, '0')}`,
        timezone: row.timezone,
        message: fillTemplate(row.messageTemplate || DEFAULT_MESSAGE_TEMPLATE, row),
        avatarUrl: row.avatarUrl || DEFAULT_AVATAR_URL
      });
      if (!dryRun) {
        db.firedAlerts.push({ channel: row.channel, username: row.username, year: parts.year, firedAt: now.toISOString() });
      }
    }
  }

  if (!dryRun) writeDb(db);

  res.json({
    serverTime: `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
    timezone,
    channel,
    due
  });
});

app.get('/api/debug/reset-year', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  const channel = normalizeChannel(req.query.channel);
  const year = Number(req.query.year) || new Date().getFullYear();
  const db = readDb();
  db.firedAlerts = db.firedAlerts.filter(item => item.year !== year || (channel && item.channel !== channel));
  writeDb(db);
  res.json({ ok: true });
});

app.get('/api/config.js', (_req, res) => {
  res.type('application/javascript').send(`window.APP_CONFIG = ${JSON.stringify({
    appBaseUrl: APP_BASE_URL,
    defaultTimezone: DEFAULT_TIMEZONE,
    defaultMessageTemplate: DEFAULT_MESSAGE_TEMPLATE,
    defaultAvatarUrl: DEFAULT_AVATAR_URL
  })};`);
});

app.get('/overlay', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Birthday Live Alert rodando em ${APP_BASE_URL}`);
});
