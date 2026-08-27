import { readFile, stat } from "node:fs/promises";
import type { Socket } from "node:net";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createDb } from "@rakazo/db";
import { type AppHandles, createApp } from "./app.js";

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8080);
const webRoot = path.resolve(import.meta.dirname, "../../web/dist");
const configTable = "rakazo_cloud_config";

process.env.API_PORT = String(port);
process.env.DATA_DIR ??= "/tmp/rakazo-data";
process.env.SANDBOX_PROVIDER ??= "desktop";
// Back4App Free has a tight memory budget. The API already contains an in-process
// job runner when WAKEUP_DRIVER=memory, so a second worker process is unnecessary.
process.env.WAKEUP_DRIVER ??= "memory";
process.env.AGENT_RUNTIME ??= "pi";

let handles: AppHandles | undefined;
let initPromise: Promise<AppHandles> | undefined;

function safePublicOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    if (!url.hostname.endsWith(".b4a.run") && process.env.RAKAZO_ALLOW_CUSTOM_ORIGIN !== "1") {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function requestOrigin(request: Request): string | undefined {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  if (!host) return undefined;
  const proto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() || "https";
  return safePublicOrigin(`${proto}://${host}`);
}

function applyPublicOrigin(origin: string) {
  process.env.BETTER_AUTH_URL ??= origin;
  process.env.WEB_ORIGIN ??= origin;
  process.env.API_URL ??= origin;
  process.env.RAKAZO_HOST ??= new URL(origin).hostname;
}

async function readPersistedOrigin(): Promise<string | undefined> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return undefined;
  const { prisma, pool } = createDb(databaseUrl);
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS ${configTable} (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
    );
    const rows = await prisma.$queryRawUnsafe<Array<{ value: string }>>(
      `SELECT value FROM ${configTable} WHERE key = 'public_origin' LIMIT 1`,
    );
    return safePublicOrigin(rows[0]?.value);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

async function persistOrigin(origin: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const { prisma, pool } = createDb(databaseUrl);
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS ${configTable} (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${configTable} (key, value) VALUES ('public_origin', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      origin,
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

async function ensureApp(origin?: string): Promise<AppHandles> {
  if (handles) return handles;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const configured = safePublicOrigin(process.env.RAKAZO_PUBLIC_URL);
    const persisted = await readPersistedOrigin();
    const resolved = configured ?? persisted ?? origin;
    if (!resolved) {
      throw new Error("Public Back4App origin not discovered yet");
    }
    applyPublicOrigin(resolved);
    if (!persisted || persisted !== resolved) await persistOrigin(resolved);
    handles = await createApp();
    console.log(`rakazo cloud ready on ${resolved}`);
    return handles;
  })();
  try {
    return await initPromise;
  } finally {
    initPromise = undefined;
  }
}

const mime = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
]);

async function staticResponse(pathname: string): Promise<Response> {
  let relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (!relative) relative = "index.html";
  const root = `${webRoot}${path.sep}`;
  let file = path.resolve(webRoot, relative);
  if (!file.startsWith(root)) return new Response("Not found", { status: 404 });

  try {
    if (!(await stat(file)).isFile()) throw new Error("not-file");
  } catch {
    file = path.join(webRoot, "index.html");
  }

  try {
    const data = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    const isIndex = file.endsWith(`${path.sep}index.html`);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": mime.get(ext) ?? "application/octet-stream",
        "cache-control": isIndex ? "no-cache" : "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Web build unavailable", { status: 503 });
  }
}

// If an origin was persisted by an earlier run, initialize immediately so
// scheduled work resumes even before a browser visits the app.
const bootOrigin = safePublicOrigin(process.env.RAKAZO_PUBLIC_URL) ?? (await readPersistedOrigin());
if (bootOrigin) {
  applyPublicOrigin(bootOrigin);
  await ensureApp(bootOrigin);
}

const server = serve({
  port,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (!handles && url.pathname === "/health") {
      return Response.json({
        ok: true,
        initializing: true,
        runtime: "pi",
        sandbox: process.env.SANDBOX_PROVIDER,
      });
    }

    let app: AppHandles;
    try {
      app = await ensureApp(requestOrigin(request));
    } catch (error) {
      console.error(error);
      return new Response("Rakazo is waiting for its public Back4App URL", { status: 503 });
    }

    const apiResponse = await app.app.fetch(request);
    if (apiResponse.status !== 404) return apiResponse;

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/rpc/")) {
      return apiResponse;
    }
    return staticResponse(url.pathname);
  },
});

const sockets = new Set<Socket>();
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  const timer = setTimeout(() => {
    for (const socket of sockets) socket.destroy();
  }, 2_000);
  await closed.catch(() => undefined);
  clearTimeout(timer);
  await handles?.stop().catch(() => undefined);
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

console.log(`rakazo Back4App listener on 0.0.0.0:${port}`);
