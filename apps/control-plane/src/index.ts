interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  ADMIN_TOKEN: string;
  WORKER_TOKEN: string;
  PUBLIC_NAME?: string;
}

type JsonMap = Record<string, unknown>;
type AuthMode = "admin" | "worker" | "either";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    },
  });
}

function bearer(request: Request): string {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function authorized(request: Request, env: Env, mode: AuthMode): boolean {
  const token = bearer(request);
  if (!token) return false;
  if (mode === "admin") return token === env.ADMIN_TOKEN;
  if (mode === "worker") return token === env.WORKER_TOKEN;
  return token === env.ADMIN_TOKEN || token === env.WORKER_TOKEN;
}

function requireAuth(request: Request, env: Env, mode: AuthMode): Response | null {
  return authorized(request, env, mode) ? null : json({ error: "unauthorized" }, 401);
}

async function bodyJson(request: Request): Promise<JsonMap> {
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
  return value as JsonMap;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function safeJsonParse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  for (const key of ["payload_json", "checkpoint_json", "result_json", "capabilities_json", "metadata_json", "detail_json"]) {
    if (key in next) {
      const parsed = safeJsonParse(next[key]);
      delete next[key];
      next[key.replace(/_json$/, "")] = parsed;
    }
  }
  return next;
}

async function event(env: Env, jobId: string, eventType: string, actor: string, detail: unknown = {}): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO job_events (job_id, event_type, actor, detail_json) VALUES (?, ?, ?, ?)",
  )
    .bind(jobId, eventType, actor, JSON.stringify(detail ?? {}))
    .run();
}

async function getJob(env: Env, id: string): Promise<Record<string, unknown> | null> {
  const row = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return row ? normalizeRow(row) : null;
}

function routeMatch(pathname: string, pattern: RegExp): RegExpMatchArray | null {
  return pathname.match(pattern);
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/health") {
    return json({ ok: true, service: "rakazo-agent-control-plane", now: new Date().toISOString() });
  }

  if (request.method === "GET" && path === "/api/stats") {
    const denied = requireAuth(request, env, "admin");
    if (denied) return denied;
    const [jobs, workers, agents, artifacts] = await env.DB.batch([
      env.DB.prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status"),
      env.DB.prepare("SELECT COUNT(*) AS count FROM workers WHERE last_seen_at >= datetime('now','-5 minutes')"),
      env.DB.prepare("SELECT COUNT(*) AS count FROM agents WHERE enabled = 1"),
      env.DB.prepare("SELECT COUNT(*) AS count FROM artifacts"),
    ]);
    return json({
      jobs: jobs.results,
      workersOnline: Number((workers.results[0] as Record<string, unknown> | undefined)?.count ?? 0),
      agentsEnabled: Number((agents.results[0] as Record<string, unknown> | undefined)?.count ?? 0),
      artifacts: Number((artifacts.results[0] as Record<string, unknown> | undefined)?.count ?? 0),
    });
  }

  if (request.method === "GET" && path === "/api/agents") {
    const denied = requireAuth(request, env, "admin");
    if (denied) return denied;
    const rows = await env.DB.prepare("SELECT * FROM agents ORDER BY rowid ASC").all<Record<string, unknown>>();
    return json({ agents: rows.results });
  }

  if (request.method === "GET" && path === "/api/workers") {
    const denied = requireAuth(request, env, "admin");
    if (denied) return denied;
    const rows = await env.DB.prepare(
      "SELECT * FROM workers ORDER BY last_seen_at DESC LIMIT 200",
    ).all<Record<string, unknown>>();
    return json({ workers: rows.results.map(normalizeRow) });
  }

  if (request.method === "POST" && path === "/api/workers/heartbeat") {
    const denied = requireAuth(request, env, "worker");
    if (denied) return denied;
    const body = await bodyJson(request);
    const workerId = text(body.workerId);
    if (!workerId) return json({ error: "workerId required" }, 400);
    const name = text(body.name, workerId);
    const capabilities = stringArray(body.capabilities);
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    await env.DB.prepare(
      `INSERT INTO workers (id, name, capabilities_json, metadata_json, status, last_seen_at, updated_at)
       VALUES (?, ?, ?, ?, 'ONLINE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         capabilities_json = excluded.capabilities_json,
         metadata_json = excluded.metadata_json,
         status = 'ONLINE',
         last_seen_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(workerId, name, JSON.stringify(capabilities), JSON.stringify(metadata))
      .run();
    return json({ ok: true, workerId });
  }

  if (request.method === "GET" && path === "/api/jobs") {
    const denied = requireAuth(request, env, "admin");
    if (denied) return denied;
    const status = text(url.searchParams.get("status"));
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 500);
    const stmt = status
      ? env.DB.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY priority DESC, created_at DESC LIMIT ?").bind(status, limit)
      : env.DB.prepare("SELECT * FROM jobs ORDER BY CASE status WHEN 'RUNNING' THEN 0 WHEN 'QUEUED' THEN 1 WHEN 'RETRY' THEN 2 ELSE 3 END, priority DESC, created_at DESC LIMIT ?").bind(limit);
    const rows = await stmt.all<Record<string, unknown>>();
    return json({ jobs: rows.results.map(normalizeRow) });
  }

  if (request.method === "POST" && path === "/api/jobs") {
    const denied = requireAuth(request, env, "admin");
    if (denied) return denied;
    const body = await bodyJson(request);
    const title = text(body.title);
    if (!title) return json({ error: "title required" }, 400);
    const id = crypto.randomUUID();
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    await env.DB.prepare(
      `INSERT INTO jobs (
        id, title, source, expediente, organismo, closing_at, agent_name,
        required_capability, priority, status, stage, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)`,
    )
      .bind(
        id,
        title,
        text(body.source, "manual"),
        text(body.expediente) || null,
        text(body.organismo) || null,
        text(body.closingAt) || null,
        text(body.agentName) || null,
        text(body.requiredCapability, "research"),
        Math.round(numberValue(body.priority, 50)),
        text(body.stage, "NUEVA"),
        JSON.stringify(payload),
      )
      .run();
    await event(env, id, "CREATED", "admin", { title, payload });
    return json({ job: await getJob(env, id) }, 201);
  }

  const jobGet = routeMatch(path, /^\/api\/jobs\/([^/]+)$/);
  if (request.method === "GET" && jobGet) {
    const denied = requireAuth(request, env, "admin");
    if (denied) return denied;
    const job = await getJob(env, decodeURIComponent(jobGet[1]));
    return job ? json({ job }) : json({ error: "not found" }, 404);
  }

  if (request.method === "POST" && path === "/api/jobs/claim") {
    const denied = requireAuth(request, env, "worker");
    if (denied) return denied;
    const body = await bodyJson(request);
    const workerId = text(body.workerId);
    const capabilities = stringArray(body.capabilities);
    const leaseSeconds = Math.min(Math.max(Math.round(numberValue(body.leaseSeconds, 900)), 60), 3600);
    if (!workerId || capabilities.length === 0) return json({ error: "workerId and capabilities required" }, 400);

    const placeholders = capabilities.map(() => "?").join(",");
    const sql = `UPDATE jobs
      SET status = 'RUNNING', lease_owner = ?, lease_until = datetime('now', '+' || ? || ' seconds'),
          attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = (
        SELECT id FROM jobs
        WHERE status IN ('QUEUED','RETRY')
          AND (lease_until IS NULL OR lease_until < CURRENT_TIMESTAMP)
          AND required_capability IN (${placeholders})
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
      )
      RETURNING *`;
    const row = await env.DB.prepare(sql)
      .bind(workerId, leaseSeconds, ...capabilities)
      .first<Record<string, unknown>>();
    if (!row) return json({ job: null });
    await event(env, String(row.id), "CLAIMED", workerId, { capabilities, leaseSeconds });
    return json({ job: normalizeRow(row) });
  }

  const checkpoint = routeMatch(path, /^\/api\/jobs\/([^/]+)\/checkpoint$/);
  if (request.method === "POST" && checkpoint) {
    const denied = requireAuth(request, env, "worker");
    if (denied) return denied;
    const id = decodeURIComponent(checkpoint[1]);
    const body = await bodyJson(request);
    const workerId = text(body.workerId);
    if (!workerId) return json({ error: "workerId required" }, 400);
    const stage = text(body.stage);
    const checkpointData = body.checkpoint && typeof body.checkpoint === "object" ? body.checkpoint : {};
    const leaseSeconds = Math.min(Math.max(Math.round(numberValue(body.leaseSeconds, 900)), 60), 3600);
    const result = await env.DB.prepare(
      `UPDATE jobs SET
         stage = CASE WHEN ? = '' THEN stage ELSE ? END,
         checkpoint_json = ?,
         lease_until = datetime('now', '+' || ? || ' seconds'),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'RUNNING' AND lease_owner = ?`,
    )
      .bind(stage, stage, JSON.stringify(checkpointData), leaseSeconds, id, workerId)
      .run();
    if (!result.meta.changes) return json({ error: "lease not owned or job not running" }, 409);
    await event(env, id, "CHECKPOINT", workerId, { stage, checkpoint: checkpointData });
    return json({ job: await getJob(env, id) });
  }

  const complete = routeMatch(path, /^\/api\/jobs\/([^/]+)\/complete$/);
  if (request.method === "POST" && complete) {
    const denied = requireAuth(request, env, "worker");
    if (denied) return denied;
    const id = decodeURIComponent(complete[1]);
    const body = await bodyJson(request);
    const workerId = text(body.workerId);
    const resultData = body.result && typeof body.result === "object" ? body.result : {};
    const finalStage = text(body.stage, "LISTA PARA FIRMAR");
    const result = await env.DB.prepare(
      `UPDATE jobs SET status = 'DONE', stage = ?, result_json = ?, lease_owner = NULL,
       lease_until = NULL, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'RUNNING' AND lease_owner = ?`,
    )
      .bind(finalStage, JSON.stringify(resultData), id, workerId)
      .run();
    if (!result.meta.changes) return json({ error: "lease not owned or job not running" }, 409);
    await event(env, id, "COMPLETED", workerId, { stage: finalStage, result: resultData });
    return json({ job: await getJob(env, id) });
  }

  const fail = routeMatch(path, /^\/api\/jobs\/([^/]+)\/fail$/);
  if (request.method === "POST" && fail) {
    const denied = requireAuth(request, env, "worker");
    if (denied) return denied;
    const id = decodeURIComponent(fail[1]);
    const body = await bodyJson(request);
    const workerId = text(body.workerId);
    const errorMessage = text(body.error, "unknown worker error").slice(0, 4000);
    const retry = body.retry !== false;
    const result = await env.DB.prepare(
      `UPDATE jobs SET status = ?, last_error = ?, lease_owner = NULL, lease_until = NULL,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'RUNNING' AND lease_owner = ?`,
    )
      .bind(retry ? "RETRY" : "FAILED", errorMessage, id, workerId)
      .run();
    if (!result.meta.changes) return json({ error: "lease not owned or job not running" }, 409);
    await event(env, id, retry ? "RETRY" : "FAILED", workerId, { error: errorMessage });
    return json({ job: await getJob(env, id) });
  }

  const requeue = routeMatch(path, /^\/api\/jobs\/([^/]+)\/requeue$/);
  if (request.method === "POST" && requeue) {
    const denied = requireAuth(request, env, "admin");
    if (denied) return denied;
    const id = decodeURIComponent(requeue[1]);
    await env.DB.prepare(
      "UPDATE jobs SET status='QUEUED', lease_owner=NULL, lease_until=NULL, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(id)
      .run();
    await event(env, id, "REQUEUED", "admin");
    return json({ job: await getJob(env, id) });
  }

  const cancel = routeMatch(path, /^\/api\/jobs\/([^/]+)\/cancel$/);
  if (request.method === "POST" && cancel) {
    const denied = requireAuth(request, env, "admin");
    if (denied) return denied;
    const id = decodeURIComponent(cancel[1]);
    await env.DB.prepare(
      "UPDATE jobs SET status='CANCELLED', lease_owner=NULL, lease_until=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(id)
      .run();
    await event(env, id, "CANCELLED", "admin");
    return json({ job: await getJob(env, id) });
  }

  const approval = routeMatch(path, /^\/api\/jobs\/([^/]+)\/approval$/);
  if (request.method === "POST" && approval) {
    const denied = requireAuth(request, env, "admin");
    if (denied) return denied;
    const id = decodeURIComponent(approval[1]);
    const body = await bodyJson(request);
    const decision = text(body.decision, "pending");
    if (!["pending", "approved", "rejected"].includes(decision)) return json({ error: "invalid decision" }, 400);
    const notes = text(body.notes).slice(0, 4000);
    await env.DB.prepare(
      "UPDATE jobs SET approval_state=?, approval_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(decision, notes, id)
      .run();
    await event(env, id, "HUMAN_APPROVAL", "admin", { decision, notes });
    return json({ job: await getJob(env, id) });
  }

  const artifactList = routeMatch(path, /^\/api\/jobs\/([^/]+)\/artifacts$/);
  if (request.method === "GET" && artifactList) {
    const denied = requireAuth(request, env, "admin");
    if (denied) return denied;
    const id = decodeURIComponent(artifactList[1]);
    const rows = await env.DB.prepare("SELECT id, job_id, name, mime_type, size_bytes, created_at FROM artifacts WHERE job_id=? ORDER BY created_at DESC")
      .bind(id)
      .all<Record<string, unknown>>();
    return json({ artifacts: rows.results });
  }

  if (request.method === "POST" && artifactList) {
    const denied = requireAuth(request, env, "either");
    if (denied) return denied;
    const id = decodeURIComponent(artifactList[1]);
    const name = text(url.searchParams.get("name"), "artifact.bin").slice(0, 180);
    const mimeType = text(url.searchParams.get("mime"), request.headers.get("content-type") ?? "application/octet-stream");
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 25 * 1024 * 1024) return json({ error: "artifact exceeds 25 MB" }, 413);
    const artifactId = crypto.randomUUID();
    const safeName = name.replace(/[^A-Za-z0-9._-]+/g, "_");
    const key = `jobs/${id}/${Date.now()}-${artifactId}-${safeName}`;
    await env.ARTIFACTS.put(key, bytes, { httpMetadata: { contentType: mimeType } });
    await env.DB.prepare(
      "INSERT INTO artifacts (id, job_id, name, object_key, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(artifactId, id, name, key, mimeType, bytes.byteLength)
      .run();
    await event(env, id, "ARTIFACT", authorized(request, env, "worker") ? "worker" : "admin", { artifactId, name, sizeBytes: bytes.byteLength });
    return json({ artifact: { id: artifactId, jobId: id, name, mimeType, sizeBytes: bytes.byteLength } }, 201);
  }

  const artifactGet = routeMatch(path, /^\/api\/artifacts\/([^/]+)$/);
  if (request.method === "GET" && artifactGet) {
    const denied = requireAuth(request, env, "admin");
    if (denied) return denied;
    const id = decodeURIComponent(artifactGet[1]);
    const row = await env.DB.prepare("SELECT * FROM artifacts WHERE id=?").bind(id).first<Record<string, unknown>>();
    if (!row) return json({ error: "not found" }, 404);
    const object = await env.ARTIFACTS.get(String(row.object_key));
    if (!object) return json({ error: "object missing" }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-disposition", `attachment; filename="${String(row.name).replace(/\"/g, "")}"`);
    headers.set("cache-control", "private, no-store");
    return new Response(object.body, { headers });
  }

  const events = routeMatch(path, /^\/api\/jobs\/([^/]+)\/events$/);
  if (request.method === "GET" && events) {
    const denied = requireAuth(request, env, "admin");
    if (denied) return denied;
    const id = decodeURIComponent(events[1]);
    const rows = await env.DB.prepare("SELECT * FROM job_events WHERE job_id=? ORDER BY id DESC LIMIT 500")
      .bind(id)
      .all<Record<string, unknown>>();
    return json({ events: rows.results.map(normalizeRow) });
  }

  return json({ error: "not found" }, 404);
}

const DASHBOARD = String.raw`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ejército de Agentes</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#f6f7f8;background:#070809}*{box-sizing:border-box}body{margin:0;background:#070809;color:#f6f7f8}.wrap{max-width:1480px;margin:auto;padding:22px}.top{display:flex;gap:16px;justify-content:space-between;align-items:center;margin-bottom:18px}.muted{color:#8d949c}.pill{border:1px solid #2a2d31;background:#111315;border-radius:999px;padding:8px 12px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{border:1px solid #22262a;background:#0d0f11;border-radius:18px;padding:17px}.metric{font-size:30px;font-weight:760;margin-top:8px}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.section{margin-top:20px}.section h2{font-size:16px;margin:0 0 10px}.job{display:grid;grid-template-columns:1.4fr .7fr .7fr .7fr;gap:10px;padding:12px 0;border-top:1px solid #1e2124;font-size:13px}.agent{padding:10px 0;border-top:1px solid #1e2124}.good{color:#8ce99a}.warn{color:#ffd43b}.bad{color:#ff8787}button,input,select,textarea{font:inherit}button{border:0;border-radius:12px;padding:10px 14px;font-weight:700;cursor:pointer;background:#f4f4f5;color:#090a0b}button.alt{background:#17191c;color:#f4f4f5;border:1px solid #2a2d31}.token{display:flex;gap:8px}.token input{min-width:220px;background:#0e1012;border:1px solid #292d31;color:#fff;border-radius:12px;padding:10px}.composer{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px}.composer input,.composer select{background:#0e1012;border:1px solid #292d31;color:#fff;border-radius:12px;padding:10px}.error{background:#32151a;border:1px solid #5b252c;padding:12px;border-radius:12px;margin:10px 0}.empty{padding:18px 0;color:#777f87}@media(max-width:850px){.grid{grid-template-columns:repeat(2,1fr)}.job{grid-template-columns:1fr 1fr}.composer{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}.wrap{padding:14px}}@media(max-width:520px){.grid{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<div class="top"><div><div class="muted" style="text-transform:uppercase;letter-spacing:.2em;font-size:11px">Central serverless</div><h1 style="margin:5px 0 0">Ejército de agentes</h1></div><div class="token"><input id="token" type="password" placeholder="Token administrador"><button class="alt" onclick="saveToken()">Entrar</button></div></div>
<div id="error"></div>
<div class="grid"><div class="card"><div class="muted">Agentes</div><div class="metric" id="agents">—</div></div><div class="card"><div class="muted">Workers online</div><div class="metric" id="workers">—</div></div><div class="card"><div class="muted">Trabajos abiertos</div><div class="metric" id="open">—</div></div><div class="card"><div class="muted">Listos / terminados</div><div class="metric" id="done">—</div></div></div>
<div class="section card"><h2>Nuevo trabajo</h2><div class="composer"><input id="title" placeholder="Ej: Procesar licitación EX-2026-..."><select id="cap"><option>research</option><option>documents</option><option>browser</option><option>analysis</option><option>calculation</option><option>audit</option><option>tender</option><option>orchestration</option></select><select id="agent"><option value="">Asignación automática</option></select><button onclick="createJob()">Enviar</button></div></div>
<div class="section card"><div class="row" style="justify-content:space-between"><h2>Cola persistente</h2><button class="alt" onclick="load()">Actualizar</button></div><div id="jobs"></div></div>
<div class="section card"><h2>Agentes definidos</h2><div id="agentList"></div></div>
<div class="section card"><h2>Límites humanos</h2><div class="muted">Los agentes pueden investigar, descargar, analizar, cotizar, calcular, auditar y preparar documentos. Firma, presentación definitiva, compras y pagos requieren aprobación humana.</div></div>
</div><script>
const $=id=>document.getElementById(id);$('token').value=sessionStorage.getItem('army-token')||'';
function headers(){return {'authorization':'Bearer '+$('token').value,'content-type':'application/json'}}
function saveToken(){sessionStorage.setItem('army-token',$('token').value);load()}
function esc(v){return String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
async function req(path,options={}){const r=await fetch(path,{...options,headers:{...headers(),...(options.headers||{})}});const t=await r.text();let d;try{d=JSON.parse(t)}catch{d={error:t}}if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}
async function load(){try{$('error').innerHTML='';const [s,j,a]=await Promise.all([req('/api/stats'),req('/api/jobs?limit=120'),req('/api/agents')]);$('agents').textContent=s.agentsEnabled;$('workers').textContent=s.workersOnline;const counts=Object.fromEntries((s.jobs||[]).map(x=>[x.status,Number(x.count)]));$('open').textContent=(counts.QUEUED||0)+(counts.RETRY||0)+(counts.RUNNING||0);$('done').textContent=counts.DONE||0;$('jobs').innerHTML=(j.jobs||[]).map(job=>'<div class="job"><div><b>'+esc(job.title)+'</b><div class="muted">'+esc(job.expediente||job.source)+' · '+esc(job.stage)+'</div></div><div>'+esc(job.status)+'</div><div>'+esc(job.agent_name||'auto')+'</div><div>'+esc(job.required_capability)+'</div></div>').join('')||'<div class="empty">Sin trabajos.</div>';$('agentList').innerHTML=(a.agents||[]).map(x=>'<div class="agent"><b>'+esc(x.name)+'</b> · '+esc(x.title)+' <span class="muted">('+esc(x.capability)+')</span><div class="muted">'+esc(x.description)+'</div></div>').join('');$('agent').innerHTML='<option value="">Asignación automática</option>'+a.agents.map(x=>'<option>'+esc(x.name)+'</option>').join('')}catch(e){$('error').innerHTML='<div class="error">'+esc(e.message)+'</div>'}}
async function createJob(){const title=$('title').value.trim();if(!title)return;try{await req('/api/jobs',{method:'POST',body:JSON.stringify({title,requiredCapability:$('cap').value,agentName:$('agent').value||undefined,priority:50,payload:{requestedFrom:'dashboard'}})});$('title').value='';await load()}catch(e){$('error').innerHTML='<div class="error">'+esc(e.message)+'</div>'}}
if($('token').value)load();
</script></body></html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await api(request, env);
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/central")) {
        return html(DASHBOARD.replace("Ejército de Agentes", env.PUBLIC_NAME || "Ejército de Agentes"));
      }
      return new Response("Not found", { status: 404 });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "unknown error";
      console.error(message);
      return json({ error: message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
