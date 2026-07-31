/**
 * Shared Turso / libSQL access — schema compatible with rtypeweb players.
 *
 * Env:
 *   LIBSQL_URL        — Turso/libSQL URL; if unset, local file: data/games.db
 *   LIBSQL_AUTH_TOKEN — optional auth token for remote Turso
 */

import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultNicknameFromEmail,
  validateEmail,
  validateNicknameOptional,
} from "./validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/** @type {import('@libsql/client').Client | null} */
let client = null;
let schemaReady = false;

/**
 * Ensure parent directory exists for file: libSQL URLs.
 * @param {string} url
 */
function ensureFileDbDir(url) {
  if (!url.startsWith("file:")) return;
  let path = url.slice("file:".length);
  // Support file:///absolute and file:relative
  if (path.startsWith("///")) path = path.slice(2);
  else if (path.startsWith("//")) path = path.slice(1);
  const dir = dirname(path);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * @returns {string}
 */
export function resolveDbUrl() {
  const url = process.env.LIBSQL_URL?.trim();
  if (url) {
    ensureFileDbDir(url);
    return url;
  }
  const dataDir = join(ROOT, "data");
  mkdirSync(dataDir, { recursive: true });
  // file: URLs for @libsql/client expect an absolute path
  return `file:${join(dataDir, "games.db")}`;
}

/**
 * @returns {import('@libsql/client').Client}
 */
export function getClient() {
  if (client) return client;
  const url = resolveDbUrl();
  const authToken = process.env.LIBSQL_AUTH_TOKEN?.trim() || undefined;
  client = createClient({
    url,
    authToken: url.startsWith("file:") ? undefined : authToken,
  });
  return client;
}

export function resetClient() {
  if (client) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
  }
  client = null;
  schemaReady = false;
}

/**
 * Ensure players (and optionally scores) match rtypeweb shared shape.
 */
export async function ensureSchema() {
  if (schemaReady) return;
  const db = getClient();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY NOT NULL,
      nickname TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_players_nickname ON players(nickname)`,
  );
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_players_email ON players(email)`,
  );
  // Optional: keep local shared DB shape consistent with games that write scores.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS scores (
      id TEXT PRIMARY KEY NOT NULL,
      player_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      game TEXT,
      created_at TEXT NOT NULL
    )
  `);
  schemaReady = true;
}

/**
 * @param {import('@libsql/client').Row} row
 */
function mapPlayer(row) {
  return {
    id: String(row.id),
    nickname: String(row.nickname),
    email: String(row.email),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/**
 * @param {string} email
 */
export async function getPlayerByEmail(email) {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: `SELECT id, nickname, email, created_at, updated_at FROM players WHERE email = ? LIMIT 1`,
    args: [email],
  });
  if (result.rows.length === 0) return null;
  return mapPlayer(result.rows[0]);
}

/**
 * @param {string} id
 */
export async function getPlayerById(id) {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: `SELECT id, nickname, email, created_at, updated_at FROM players WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return mapPlayer(result.rows[0]);
}

/**
 * @param {string} nickname
 */
async function nicknameTaken(nickname) {
  const db = getClient();
  const result = await db.execute({
    sql: `SELECT 1 AS ok FROM players WHERE nickname = ? LIMIT 1`,
    args: [nickname],
  });
  return result.rows.length > 0;
}

/**
 * Ensure a unique nickname, appending numeric suffix on collision.
 * @param {string} base
 * @returns {Promise<string>}
 */
async function uniqueNickname(base) {
  let candidate = base.slice(0, 32);
  if (!(await nicknameTaken(candidate))) return candidate;
  for (let i = 2; i < 10000; i++) {
    const suffix = String(i);
    const maxBase = 32 - suffix.length;
    candidate = base.slice(0, Math.max(1, maxBase)) + suffix;
    if (!(await nicknameTaken(candidate))) return candidate;
  }
  // Extremely unlikely fallback
  return uniqueNickname(`${base.slice(0, 16)}_${randomUUID().slice(0, 8)}`);
}

/**
 * Upsert by email: returning users get existing row (nickname ignored).
 * New users get optional nickname or default from email local-part.
 *
 * @param {{ email: string, nickname?: string|null }} input
 */
export async function upsertPlayerByEmail(input) {
  await ensureSchema();
  const email = validateEmail(input.email);
  const providedNick = validateNicknameOptional(input.nickname);

  const existing = await getPlayerByEmail(email);
  if (existing) {
    // Login-by-email: ignore nickname mismatches to avoid identity conflicts.
    return { player: existing, created: false };
  }

  const baseNick = providedNick || defaultNicknameFromEmail(email);
  const nickname = await uniqueNickname(baseNick);
  const now = new Date().toISOString();
  const id = randomUUID();
  const db = getClient();

  try {
    await db.execute({
      sql: `INSERT INTO players (id, nickname, email, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, nickname, email, now, now],
    });
  } catch (err) {
    // Race: another request created the email or nickname
    const again = await getPlayerByEmail(email);
    if (again) return { player: again, created: false };
    const message = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(`Failed to create player: ${message}`), {
      status: 500,
      code: "DB_INSERT_FAILED",
    });
  }

  const player = await getPlayerById(id);
  if (!player) {
    throw Object.assign(new Error("Player created but not found"), {
      status: 500,
      code: "DB_INCONSISTENT",
    });
  }
  return { player, created: true };
}
