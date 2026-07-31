/**
 * Smoke test against a running local API (or starts one if SMOKE_BASE unset and port free).
 *
 * Usage:
 *   npm run api   # terminal 1
 *   npm run smoke # terminal 2
 *
 * Or:
 *   SMOKE_BASE=http://localhost:3000 npm run smoke
 *
 * If nothing is listening, this script starts local-api on an ephemeral port.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

let base = process.env.SMOKE_BASE || "";
/** @type {import('child_process').ChildProcess | null} */
let child = null;
const smokeDb = resolve(ROOT, "data", `smoke-${randomUUID()}.db`);

function fail(msg) {
  console.error("FAIL:", msg);
  cleanup();
  process.exit(1);
}

function ok(msg) {
  console.log("OK:", msg);
}

function cleanup() {
  if (child && !child.killed) {
    child.kill("SIGTERM");
  }
  try {
    rmSync(smokeDb, { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} path
 * @param {RequestInit & { cookie?: string }} [opts]
 */
async function req(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (opts.cookie) headers.set("Cookie", opts.cookie);
  if (opts.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers,
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  // Node < 20 may not have getSetCookie
  const raw =
    setCookie.length > 0
      ? setCookie
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")]
        : [];
  let text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, json, text, setCookie: raw };
}

function extractSessionCookie(setCookie) {
  for (const c of setCookie) {
    if (!c) continue;
    const m = String(c).match(/portal_session=([^;]+)/);
    if (m) return `portal_session=${m[1]}`;
  }
  return null;
}

async function waitForServer(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  fail(`Server did not become ready at ${url}`);
}

async function ensureServer() {
  if (base) {
    await waitForServer(base);
    return;
  }

  // Start local API with isolated file DB
  const port = 3456 + Math.floor(Math.random() * 200);
  base = `http://127.0.0.1:${port}`;
  child = spawn(
    process.execPath,
    [resolve(ROOT, "scripts/local-api.mjs")],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        LIBSQL_URL: `file:${smokeDb}`,
        PORTAL_SESSION_SECRET: "smoke-test-secret-key-32chars!!",
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (d) => process.stdout.write(`[api] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[api] ${d}`));
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[api] exited ${code}`);
    }
  });
  await waitForServer(base);
}

async function main() {
  await ensureServer();
  console.log("Smoke against", base);

  // 1. Catalog page
  {
    const { res, text } = await req("/");
    if (res.status !== 200) fail(`GET / → ${res.status}`);
    if (!text.includes("River Raid") || !text.includes("R-Type")) {
      fail("Catalog HTML missing expected game titles");
    }
    ok("GET / serves catalog page with both games");
  }

  const email = `smoke-${randomUUID().slice(0, 8)}@example.com`;

  // 2. Register
  let cookie;
  let playerId;
  let handoffToken;
  {
    const { res, json, setCookie } = await req("/api/auth/session", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (res.status !== 201 && res.status !== 200) {
      fail(`POST session register → ${res.status} ${JSON.stringify(json)}`);
    }
    if (!json?.player?.id) fail("Register missing player.id");
    if (!json.player.nickname) fail("Register missing nickname default");
    if (json.player.email !== email) fail("Register email mismatch");
    cookie = extractSessionCookie(setCookie);
    if (!cookie) fail("Register missing Set-Cookie portal_session");
    playerId = json.player.id;
    handoffToken = json.handoffToken;
    if (!handoffToken) fail("Register missing handoffToken");
    ok(`Register ${email} → id=${playerId} nick=${json.player.nickname}`);
  }

  // 3. Idempotent login
  {
    const { res, json, setCookie } = await req("/api/auth/session", {
      method: "POST",
      body: JSON.stringify({ email, nickname: "ignored-on-login" }),
    });
    if (res.status !== 200 && res.status !== 201) {
      fail(`POST session login → ${res.status}`);
    }
    if (json.player.id !== playerId) fail("Login returned different player id");
    if (json.created === true) fail("Login should not set created=true");
    cookie = extractSessionCookie(setCookie) || cookie;
    ok("Same email returns same player id (idempotent)");
  }

  // 4. /me with cookie
  {
    const { res, json } = await req("/api/auth/me", { cookie });
    if (res.status !== 200) fail(`GET /me → ${res.status} ${JSON.stringify(json)}`);
    if (json.player.id !== playerId) fail("/me player id mismatch");
    handoffToken = json.handoffToken || handoffToken;
    ok("GET /api/auth/me with session cookie");
  }

  // 5. verify handoff token
  {
    const { res, json } = await req(
      `/api/auth/verify?token=${encodeURIComponent(handoffToken)}`,
    );
    if (res.status !== 200) fail(`GET verify → ${res.status} ${JSON.stringify(json)}`);
    if (!json.valid) fail("verify.valid not true");
    if (json.player.id !== playerId) fail("verify player id mismatch");
    if (json.player.email !== email) fail("verify email mismatch");
    ok("GET /api/auth/verify returns player claims");
  }

  // 6. invalid token
  {
    const { res, json } = await req("/api/auth/verify?token=not-a-token");
    if (res.status !== 401) fail(`invalid token expected 401 got ${res.status}`);
    ok("Invalid token rejected with 401");
  }

  // 7. logout
  {
    const { res, setCookie } = await req("/api/auth/logout", {
      method: "POST",
      cookie,
    });
    if (res.status !== 200) fail(`logout → ${res.status}`);
    const cleared = setCookie.some((c) => /portal_session=/.test(String(c)));
    if (!cleared) fail("logout missing clear Set-Cookie");
    ok("POST /api/auth/logout clears session");
  }

  console.log("\nAll smoke checks passed.");
  cleanup();
  process.exit(0);
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
