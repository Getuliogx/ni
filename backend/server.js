import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  initStorage,
  storageInfo,
  listBirthdays,
  getBirthday,
  createBirthday,
  updateBirthday,
  deleteBirthday,
  createManualAlert,
  listRecentManualAlerts,
  cleanupManualAlerts,
  exportData,
  importData,
} from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 10000);
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const ADMIN_KEY = String(process.env.ADMIN_KEY || '').trim();
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'America/Sao_Paulo';
const DEFAULT_MESSAGE_TEMPLATE = process.env.DEFAULT_MESSAGE_TEMPLATE || '🎉 Feliz aniversário, {nick}!';
const RECENT_ALERT_SECONDS = Number(process.env.RECENT_ALERT_SECONDS || 20);
const DEFAULT_AVATAR_URL = process.env.DEFAULT_AVATAR_URL || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/215b7342-def9-11e9-9a66-784f43822e80-profile_image-300x300.png';
const AVATAR_LOOKUP_TIMEOUT_MS = Number(process.env.AVATAR_LOOKUP_TIMEOUT_MS || 7000);
const AVATAR_CACHE_HOURS = Number(process.env.AVATAR_CACHE_HOURS || 6);

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const avatarCache = new Map();

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}
function normalizeChannel(value = '') {
  return String(value).trim().toLowerCase().replace(/^@/, '');
}
function normalizeUser(value = '') {
  return String(value).trim().replace(/^@/, '');
}
function parseDateBR(dateStr = '') {
  const match = String(dateStr).trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const daysInMonth = new Date(2024, month, 0).getDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  return { day, month, normalized: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}` };
}
function parseTimeStr(timeStr = '') {
  const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute, normalized: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}
function nowInTimezone(timezone = DEFAULT_TIMEZONE) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(get('year')), month: Number(get('month')), day: Number(get('day')),
    hour: Number(get('hour')), minute: Number(get('minute')), second: Number(get('second')),
    iso: now.toISOString(),
  };
}
function buildMessage(template, vars) {
  return String(template || DEFAULT_MESSAGE_TEMPLATE)
    .replaceAll('{nick}', vars.nick || '')
    .replaceAll('{channel}', vars.channel || '')
    .replaceAll('{date}', vars.date || '')
    .replaceAll('{time}', vars.time || '');
}
function sanitizeAvatarUrl(value = '') {
  const url = String(value || '').trim();
  if (!url) return DEFAULT_AVATAR_URL;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return DEFAULT_AVATAR_URL;
    return parsed.toString();
  } catch {
    return DEFAULT_AVATAR_URL;
  }
}
function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ ok: false, error: 'ADMIN_KEY não configurada no servidor.' });
  const key = String(req.get('x-admin-key') || req.query.key || '');
  if (!safeEqual(key, ADMIN_KEY)) return res.status(401).json({ ok: false, error: 'Senha do painel incorreta.' });
  next();
}
function validateBirthdayBody(body = {}) {
  const channel = normalizeChannel(body.channel);
  const username = normalizeUser(body.username);
  const date = parseDateBR(body.date);
  const time = parseTimeStr(body.time);
  if (!channel) throw new Error('Informe o canal.');
  if (!username) throw new Error('Informe o nick.');
  if (!date) throw new Error('Data inválida. Use DD/MM.');
  if (!time) throw new Error('Horário inválido. Use HH:MM.');
  return {
    channel,
    username,
    date: date.normalized,
    time: time.normalized,
    avatarUrl: sanitizeAvatarUrl(body.avatarUrl),
    messageTemplate: String(body.messageTemplate || '').trim() || DEFAULT_MESSAGE_TEMPLATE,
    enabled: body.enabled !== false,
  };
}

function decodeHtmlEntities(value = '') {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function isRealAvatarUrl(value = '') {
  const url = String(value || '').trim();
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const lower = parsed.toString().toLowerCase();
    return !lower.includes('user-default-pictures')
      && !lower.includes('404_preview')
      && !lower.includes('/default-')
      && !lower.includes('placeholder');
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AVATAR_LOOKUP_TIMEOUT_MS);
  try {
    return await fetch(url, { redirect: 'follow', ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extractProfileImageFromHtml(html = '') {
  const metaTags = String(html).match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const property = tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!['og:image', 'twitter:image', 'twitter:image:src'].includes(property)) continue;
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
    const decoded = decodeHtmlEntities(content || '');
    if (isRealAvatarUrl(decoded)) return decoded;
  }
  return '';
}

async function avatarFromTwitchProfilePage(login) {
  const response = await fetchWithTimeout(`https://www.twitch.tv/${encodeURIComponent(login)}`, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
    },
  });
  if (!response.ok) return '';
  return extractProfileImageFromHtml(await response.text());
}

async function avatarFromDecapi(login) {
  const response = await fetchWithTimeout(`https://decapi.me/twitch/avatar/${encodeURIComponent(login)}`, {
    headers: { Accept: 'text/plain' },
  });
  if (!response.ok) return '';
  const value = (await response.text()).trim();
  return isRealAvatarUrl(value) ? value : '';
}

async function avatarFromIvr(login) {
  const url = new URL('https://api.ivr.fi/v2/twitch/user');
  url.searchParams.set('login', login);
  const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) return '';
  const data = await response.json();
  const user = Array.isArray(data) ? data[0] : data;
  const value = user?.logo || user?.profileImageURL || user?.profile_image_url || '';
  return isRealAvatarUrl(value) ? value : '';
}

async function fetchTwitchAvatar(login = '', { force = false } = {}) {
  const normalizedLogin = normalizeUser(login).toLowerCase();
  if (!normalizedLogin) return '';

  const cached = avatarCache.get(normalizedLogin);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.url;

  const sources = [avatarFromTwitchProfilePage, avatarFromDecapi, avatarFromIvr];
  for (const source of sources) {
    try {
      const avatarUrl = await source(normalizedLogin);
      if (!avatarUrl) continue;
      avatarCache.set(normalizedLogin, {
        url: avatarUrl,
        expiresAt: Date.now() + Math.max(1, AVATAR_CACHE_HOURS) * 60 * 60 * 1000,
      });
      return avatarUrl;
    } catch (error) {
      console.error(`Falha em ${source.name} para ${normalizedLogin}:`, error.message);
    }
  }

  avatarCache.set(normalizedLogin, { url: '', expiresAt: Date.now() + 10 * 60 * 1000 });
  return '';
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    name: 'Birthday Live Alert',
    appBaseUrl: APP_BASE_URL,
    timezone: DEFAULT_TIMEZONE,
    storage: storageInfo(),
    admin: '/admin',
  });
});

app.get('/health', (_req, res) => res.json({ ok: true, storage: storageInfo() }));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/register', async (req, res, next) => {
  try {
    const data = validateBirthdayBody({
      channel: req.query.channel,
      username: req.query.user,
      date: req.query.date,
      time: req.query.time,
      avatarUrl: req.query.avatarUrl,
      messageTemplate: req.query.message,
    });
    if (!String(req.query.avatarUrl || '').trim()) data.avatarUrl = (await fetchTwitchAvatar(data.username)) || DEFAULT_AVATAR_URL;
    const item = await createBirthday({ id: uid('reg'), ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    res.type('text/plain; charset=utf-8').send(`Aniversário de ${item.username} adicionado para ${item.date} às ${item.time}.`);
  } catch (error) {
    if (/Informe|inválid/i.test(error.message)) return res.status(400).type('text/plain; charset=utf-8').send(error.message);
    next(error);
  }
});

app.get('/api/admin/status', requireAdmin, async (_req, res) => {
  const items = await listBirthdays();
  res.json({ ok: true, storage: storageInfo(), total: items.length, enabled: items.filter((item) => item.enabled).length });
});

app.get('/api/admin/birthdays', requireAdmin, async (req, res) => {
  const items = await listBirthdays({ channel: req.query.channel, search: req.query.search });
  res.json({ ok: true, items, total: items.length });
});

app.post('/api/admin/birthdays', requireAdmin, async (req, res, next) => {
  try {
    const data = validateBirthdayBody(req.body);
    if (!String(req.body.avatarUrl || '').trim()) data.avatarUrl = (await fetchTwitchAvatar(data.username)) || DEFAULT_AVATAR_URL;
    const now = new Date().toISOString();
    const item = await createBirthday({ id: uid('reg'), ...data, createdAt: now, updatedAt: now });
    res.status(201).json({ ok: true, item });
  } catch (error) {
    if (/Informe|inválid/i.test(error.message)) return res.status(400).json({ ok: false, error: error.message });
    next(error);
  }
});

app.put('/api/admin/birthdays/:id', requireAdmin, async (req, res, next) => {
  try {
    const data = validateBirthdayBody(req.body);
    if (!String(req.body.avatarUrl || '').trim()) data.avatarUrl = (await fetchTwitchAvatar(data.username)) || DEFAULT_AVATAR_URL;
    const item = await updateBirthday(req.params.id, data);
    if (!item) return res.status(404).json({ ok: false, error: 'Aniversário não encontrado.' });
    res.json({ ok: true, item });
  } catch (error) {
    if (/Informe|inválid/i.test(error.message)) return res.status(400).json({ ok: false, error: error.message });
    next(error);
  }
});

app.patch('/api/admin/birthdays/:id/enabled', requireAdmin, async (req, res) => {
  const existing = await getBirthday(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Aniversário não encontrado.' });
  const item = await updateBirthday(req.params.id, { enabled: req.body.enabled === true });
  res.json({ ok: true, item });
});

app.delete('/api/admin/birthdays/:id', requireAdmin, async (req, res) => {
  const removed = await deleteBirthday(req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'Aniversário não encontrado.' });
  res.json({ ok: true });
});

app.post('/api/admin/birthdays/:id/test', requireAdmin, async (req, res) => {
  const item = await getBirthday(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Aniversário não encontrado.' });
  const alert = await createManualAlert({
    id: uid('manual'),
    channel: item.channel,
    username: item.username,
    date: item.date,
    time: item.time,
    avatarUrl: sanitizeAvatarUrl(item.avatarUrl),
    message: buildMessage(item.messageTemplate, { nick: item.username, channel: item.channel, date: item.date, time: item.time }),
    createdAt: new Date().toISOString(),
  });
  res.json({ ok: true, alert });
});

app.post('/api/admin/avatars/refresh', requireAdmin, async (_req, res) => {
  const items = await listBirthdays();
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const item of items) {
    const avatarUrl = await fetchTwitchAvatar(item.username, { force: true });
    if (!avatarUrl) {
      failed += 1;
      continue;
    }
    if (avatarUrl === item.avatarUrl) {
      unchanged += 1;
      continue;
    }
    await updateBirthday(item.id, { avatarUrl });
    updated += 1;
  }

  res.json({ ok: true, total: items.length, updated, unchanged, failed });
});

app.get('/api/admin/backup', requireAdmin, async (_req, res) => {
  const backup = await exportData();
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="aniversarios-backup-${stamp}.json"`);
  res.json(backup);
});

app.post('/api/admin/restore', requireAdmin, async (req, res, next) => {
  try {
    const imported = await importData(req.body?.backup, { replace: req.body?.replace === true });
    res.json({ ok: true, imported });
  } catch (error) {
    if (/Backup inválido/i.test(error.message)) return res.status(400).json({ ok: false, error: error.message });
    next(error);
  }
});

app.get('/api/test-alert', async (req, res) => {
  const channel = normalizeChannel(req.query.channel);
  const username = normalizeUser(req.query.user || 'testeviewer');
  if (!channel) return res.status(400).json({ ok: false, error: 'channel obrigatório' });
  const nowLocal = nowInTimezone(String(req.query.timezone || DEFAULT_TIMEZONE));
  const date = `${String(nowLocal.day).padStart(2, '0')}/${String(nowLocal.month).padStart(2, '0')}`;
  const time = `${String(nowLocal.hour).padStart(2, '0')}:${String(nowLocal.minute).padStart(2, '0')}`;
  const avatarUrl = String(req.query.avatarUrl || '').trim() || (await fetchTwitchAvatar(username)) || DEFAULT_AVATAR_URL;
  const alert = await createManualAlert({
    id: uid('manual'), channel, username, date, time,
    avatarUrl: sanitizeAvatarUrl(avatarUrl),
    message: buildMessage(DEFAULT_MESSAGE_TEMPLATE, { nick: username, channel, date, time }),
    createdAt: new Date().toISOString(),
  });
  res.json({ ok: true, created: alert });
});

app.get('/api/overlay/alerts', async (req, res) => {
  const channel = normalizeChannel(req.query.channel);
  const timezone = String(req.query.timezone || DEFAULT_TIMEZONE);
  if (!channel) return res.status(400).json({ ok: false, error: 'channel obrigatório' });

  const cleanupCutoff = new Date(Date.now() - (RECENT_ALERT_SECONDS + 120) * 1000).toISOString();
  await cleanupManualAlerts(cleanupCutoff);
  const recentCutoff = new Date(Date.now() - RECENT_ALERT_SECONDS * 1000).toISOString();
  const manualAlerts = await listRecentManualAlerts(channel, recentCutoff);
  const nowLocal = nowInTimezone(timezone);
  const due = manualAlerts.map((alert) => ({
    id: alert.id,
    channel,
    username: alert.username,
    date: alert.date,
    time: alert.time,
    avatarUrl: sanitizeAvatarUrl(alert.avatarUrl),
    message: alert.message,
  }));

  const registrations = await listBirthdays({ channel });
  for (const reg of registrations) {
    if (!reg.enabled) continue;
    const date = parseDateBR(reg.date);
    const time = parseTimeStr(reg.time);
    if (!date || !time) continue;
    if (date.day !== nowLocal.day || date.month !== nowLocal.month || time.hour !== nowLocal.hour || time.minute !== nowLocal.minute) continue;
    const occurrenceId = `${reg.id}_${nowLocal.year}_${String(nowLocal.month).padStart(2, '0')}_${String(nowLocal.day).padStart(2, '0')}_${String(nowLocal.hour).padStart(2, '0')}${String(nowLocal.minute).padStart(2, '0')}`;
    due.push({
      id: occurrenceId,
      channel,
      username: reg.username,
      date: reg.date,
      time: reg.time,
      avatarUrl: sanitizeAvatarUrl(reg.avatarUrl),
      message: buildMessage(reg.messageTemplate, { nick: reg.username, channel, date: reg.date, time: reg.time }),
    });
  }

  res.json({ ok: true, serverTime: nowLocal.iso, timezone, channel, due });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ ok: false, error: 'Erro interno do servidor.' });
});

initStorage()
  .then(() => {
    app.listen(PORT, () => console.log(`Birthday Live Alert rodando em ${APP_BASE_URL} (${storageInfo().label})`));
  })
  .catch((error) => {
    console.error('Não foi possível iniciar o armazenamento:', error);
    process.exit(1);
  });
