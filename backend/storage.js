import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const LOCAL_DB_PATH = path.join(__dirname, 'data', 'db.json');
const LEGACY_DB_PATHS = [
  LOCAL_DB_PATH,
  path.join(__dirname, 'data.json'),
];

let pool = null;
let mode = DATABASE_URL ? 'postgres' : 'local';

function emptyDb() {
  return { registrations: [], manualAlerts: [] };
}

function readLocalDb() {
  for (const candidate of LEGACY_DB_PATHS) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      return {
        registrations: Array.isArray(parsed.registrations)
          ? parsed.registrations
          : Array.isArray(parsed.birthdays) ? parsed.birthdays : [],
        manualAlerts: Array.isArray(parsed.manualAlerts)
          ? parsed.manualAlerts
          : Array.isArray(parsed.testAlerts) ? parsed.testAlerts : [],
      };
    } catch {}
  }
  return emptyDb();
}

function writeLocalDb(db) {
  fs.mkdirSync(path.dirname(LOCAL_DB_PATH), { recursive: true });
  const tmp = `${LOCAL_DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, LOCAL_DB_PATH);
}

function normalizeRegistration(item = {}) {
  const date = String(item.date || '').padStart(5, '0');
  const time = String(item.time || '00:00').padStart(5, '0');
  return {
    id: String(item.id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160),
    channel: String(item.channel || '').toLowerCase(),
    username: String(item.username || ''),
    date,
    time,
    avatarUrl: String(item.avatarUrl || ''),
    messageTemplate: String(item.messageTemplate || ''),
    enabled: item.enabled !== false,
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
  };
}

function rowToRegistration(row) {
  return {
    id: row.id,
    channel: row.channel,
    username: row.username,
    date: row.date_text,
    time: row.time_text,
    avatarUrl: row.avatar_url || '',
    messageTemplate: row.message_template || '',
    enabled: row.enabled !== false,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function rowToManualAlert(row) {
  return {
    id: row.id,
    channel: row.channel,
    username: row.username,
    date: row.date_text,
    time: row.time_text,
    avatarUrl: row.avatar_url || '',
    message: row.message || '',
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function initStorage() {
  if (!DATABASE_URL) {
    const db = readLocalDb();
    writeLocalDb(db);
    mode = 'local';
    return;
  }

  const sslDisabled = String(process.env.DATABASE_SSL || '').toLowerCase() === 'false';
  const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
  const pgModule = await import('pg');
  const Pool = pgModule.default?.Pool || pgModule.Pool;
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: sslDisabled || isLocal ? false : { rejectUnauthorized: false },
    max: Number(process.env.DATABASE_POOL_MAX || 5),
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS birthdays (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      username TEXT NOT NULL,
      date_text TEXT NOT NULL,
      time_text TEXT NOT NULL,
      avatar_url TEXT NOT NULL DEFAULT '',
      message_template TEXT NOT NULL DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_birthdays_channel ON birthdays(channel);
    CREATE INDEX IF NOT EXISTS idx_birthdays_date_time ON birthdays(date_text, time_text);

    CREATE TABLE IF NOT EXISTS manual_alerts (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      username TEXT NOT NULL,
      date_text TEXT NOT NULL,
      time_text TEXT NOT NULL,
      avatar_url TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_manual_alerts_created_at ON manual_alerts(created_at);
  `);

  mode = 'postgres';
  await migrateLegacyIfEmpty();
}

async function migrateLegacyIfEmpty() {
  const count = await pool.query('SELECT COUNT(*)::int AS total FROM birthdays');
  if ((count.rows[0]?.total || 0) > 0) return;
  const legacy = readLocalDb();
  for (const raw of legacy.registrations || []) {
    const item = normalizeRegistration(raw);
    if (!item.id || !item.channel || !item.username || !item.date || !item.time) continue;
    await createBirthday(item);
  }
}

export function storageInfo() {
  return {
    mode,
    persistent: mode === 'postgres',
    label: mode === 'postgres' ? 'PostgreSQL externo' : 'Arquivo local temporário',
  };
}

export async function listBirthdays({ channel = '', search = '' } = {}) {
  const normalizedChannel = String(channel || '').trim().toLowerCase();
  const normalizedSearch = String(search || '').trim().toLowerCase();

  if (mode === 'postgres') {
    const conditions = [];
    const values = [];
    if (normalizedChannel) {
      values.push(normalizedChannel);
      conditions.push(`channel = $${values.length}`);
    }
    if (normalizedSearch) {
      values.push(`%${normalizedSearch}%`);
      conditions.push(`(LOWER(username) LIKE $${values.length} OR LOWER(channel) LIKE $${values.length} OR LOWER(message_template) LIKE $${values.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT * FROM birthdays ${where} ORDER BY SUBSTRING(date_text, 4, 2)::int, SUBSTRING(date_text, 1, 2)::int, time_text, LOWER(username)`,
      values,
    );
    return result.rows.map(rowToRegistration);
  }

  const db = readLocalDb();
  return (db.registrations || [])
    .map(normalizeRegistration)
    .filter((item) => !normalizedChannel || item.channel === normalizedChannel)
    .filter((item) => !normalizedSearch || [item.username, item.channel, item.messageTemplate].join(' ').toLowerCase().includes(normalizedSearch))
    .sort((a, b) => `${a.date.slice(3)}${a.date.slice(0,2)}${a.time}${a.username.toLowerCase()}`.localeCompare(`${b.date.slice(3)}${b.date.slice(0,2)}${b.time}${b.username.toLowerCase()}`));
}

export async function getBirthday(id) {
  if (mode === 'postgres') {
    const result = await pool.query('SELECT * FROM birthdays WHERE id = $1', [id]);
    return result.rows[0] ? rowToRegistration(result.rows[0]) : null;
  }
  const db = readLocalDb();
  const item = (db.registrations || []).find((entry) => entry.id === id);
  return item ? normalizeRegistration(item) : null;
}

export async function createBirthday(input) {
  const item = normalizeRegistration(input);
  if (mode === 'postgres') {
    const result = await pool.query(
      `INSERT INTO birthdays (id, channel, username, date_text, time_text, avatar_url, message_template, enabled, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [item.id, item.channel, item.username, item.date, item.time, item.avatarUrl, item.messageTemplate, item.enabled, item.createdAt, item.updatedAt],
    );
    return rowToRegistration(result.rows[0]);
  }
  const db = readLocalDb();
  db.registrations = db.registrations || [];
  db.registrations.push(item);
  writeLocalDb(db);
  return item;
}

export async function updateBirthday(id, changes) {
  const existing = await getBirthday(id);
  if (!existing) return null;
  const item = normalizeRegistration({ ...existing, ...changes, id, updatedAt: new Date().toISOString() });

  if (mode === 'postgres') {
    const result = await pool.query(
      `UPDATE birthdays
       SET channel=$2, username=$3, date_text=$4, time_text=$5, avatar_url=$6, message_template=$7, enabled=$8, updated_at=$9
       WHERE id=$1 RETURNING *`,
      [id, item.channel, item.username, item.date, item.time, item.avatarUrl, item.messageTemplate, item.enabled, item.updatedAt],
    );
    return result.rows[0] ? rowToRegistration(result.rows[0]) : null;
  }

  const db = readLocalDb();
  const index = (db.registrations || []).findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  db.registrations[index] = item;
  writeLocalDb(db);
  return item;
}

export async function deleteBirthday(id) {
  if (mode === 'postgres') {
    const result = await pool.query('DELETE FROM birthdays WHERE id = $1 RETURNING id', [id]);
    return result.rowCount > 0;
  }
  const db = readLocalDb();
  const before = (db.registrations || []).length;
  db.registrations = (db.registrations || []).filter((entry) => entry.id !== id);
  writeLocalDb(db);
  return db.registrations.length < before;
}

export async function createManualAlert(input) {
  const item = {
    id: String(input.id),
    channel: String(input.channel).toLowerCase(),
    username: String(input.username),
    date: String(input.date),
    time: String(input.time),
    avatarUrl: String(input.avatarUrl || ''),
    message: String(input.message || ''),
    createdAt: input.createdAt || new Date().toISOString(),
  };
  if (mode === 'postgres') {
    const result = await pool.query(
      `INSERT INTO manual_alerts (id, channel, username, date_text, time_text, avatar_url, message, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [item.id, item.channel, item.username, item.date, item.time, item.avatarUrl, item.message, item.createdAt],
    );
    return rowToManualAlert(result.rows[0]);
  }
  const db = readLocalDb();
  db.manualAlerts = db.manualAlerts || [];
  db.manualAlerts.push(item);
  writeLocalDb(db);
  return item;
}

export async function listRecentManualAlerts(channel, cutoffIso) {
  if (mode === 'postgres') {
    const result = await pool.query(
      'SELECT * FROM manual_alerts WHERE channel=$1 AND created_at >= $2 ORDER BY created_at ASC',
      [channel, cutoffIso],
    );
    return result.rows.map(rowToManualAlert);
  }
  const cutoff = new Date(cutoffIso).getTime();
  const db = readLocalDb();
  return (db.manualAlerts || []).filter((item) => item.channel === channel && new Date(item.createdAt).getTime() >= cutoff);
}

export async function cleanupManualAlerts(cutoffIso) {
  if (mode === 'postgres') {
    await pool.query('DELETE FROM manual_alerts WHERE created_at < $1', [cutoffIso]);
    return;
  }
  const cutoff = new Date(cutoffIso).getTime();
  const db = readLocalDb();
  db.manualAlerts = (db.manualAlerts || []).filter((item) => new Date(item.createdAt).getTime() >= cutoff);
  writeLocalDb(db);
}

export async function exportData() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    registrations: await listBirthdays(),
  };
}

export async function importData(payload, { replace = false } = {}) {
  const registrations = Array.isArray(payload?.registrations)
    ? payload.registrations
    : Array.isArray(payload?.birthdays) ? payload.birthdays : null;
  if (!registrations) throw new Error('Backup inválido: lista de aniversários não encontrada.');

  if (mode === 'postgres') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (replace) await client.query('DELETE FROM birthdays');
      let imported = 0;
      for (const raw of registrations) {
        const item = normalizeRegistration(raw);
        if (!item.id || !item.channel || !item.username || !item.date || !item.time) continue;
        await client.query(
          `INSERT INTO birthdays (id, channel, username, date_text, time_text, avatar_url, message_template, enabled, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO UPDATE SET channel=EXCLUDED.channel, username=EXCLUDED.username,
             date_text=EXCLUDED.date_text, time_text=EXCLUDED.time_text, avatar_url=EXCLUDED.avatar_url,
             message_template=EXCLUDED.message_template, enabled=EXCLUDED.enabled, updated_at=NOW()`,
          [item.id, item.channel, item.username, item.date, item.time, item.avatarUrl, item.messageTemplate, item.enabled, item.createdAt, item.updatedAt],
        );
        imported += 1;
      }
      await client.query('COMMIT');
      return imported;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const db = replace ? emptyDb() : readLocalDb();
  const byId = new Map((db.registrations || []).map((item) => [item.id, normalizeRegistration(item)]));
  let imported = 0;
  for (const raw of registrations) {
    const item = normalizeRegistration(raw);
    if (!item.id || !item.channel || !item.username || !item.date || !item.time) continue;
    byId.set(item.id, item);
    imported += 1;
  }
  db.registrations = [...byId.values()];
  writeLocalDb(db);
  return imported;
}
