# Rakazo Agent Control Plane

Central serverless para coordinar un ejército de agentes sin mantener un VPS grande encendido 24/7.

## Qué hace

- Dashboard web en el propio Cloudflare Worker.
- D1 como cola persistente, estado, leases, checkpoints y auditoría.
- R2 para PDFs, planillas, presupuestos y demás artefactos.
- Workers externos que pueden correr en una PC propia, VPS barato o servidor efímero y reclamar trabajo sólo cuando están activos.
- Reanudación: cada job conserva `stage`, `checkpoint`, intentos, error y lease.
- Roles base: GENERAL, LICITADOR, DETECTOR, PLIEGOS, PRECIOS ARGENTINA, PRECIOS PARAGUAY, MATCH TÉCNICO, STOCK, COSTOS, AUDITOR y DOCUMENTADOR.
- Límite humano explícito: el sistema no firma, no presenta definitivamente, no compra y no paga por sí solo.

## Recursos Cloudflare

Crear una base D1 llamada `rakazo-agent-army` y un bucket R2 llamado `rakazo-agent-artifacts`.

Cloudflare Wrangler devuelve el `database_id` al crear D1. Reemplazar `REPLACE_WITH_D1_DATABASE_ID` en `wrangler.toml` por ese valor.

Luego configurar dos secretos distintos:

- `ADMIN_TOKEN`: abre el dashboard y permite crear/reencolar/cancelar trabajos y registrar aprobación humana.
- `WORKER_TOKEN`: sólo para ejecutores que hacen heartbeat, reclaman jobs, guardan checkpoints y completan/fallan tareas.

No guardar esos tokens en Git.

## Despliegue

Desde `apps/control-plane`:

1. `pnpm install`
2. `pnpm db:create`
3. reemplazar el database id en `wrangler.toml`
4. `pnpm r2:create`
5. `npx wrangler secret put ADMIN_TOKEN`
6. `npx wrangler secret put WORKER_TOKEN`
7. `pnpm db:migrate:remote`
8. `pnpm deploy`

Abrir la URL del Worker, colocar el token administrador y pulsar Entrar.

## Ejecutores baratos

`infra/edge-workers/worker.py` convierte cualquier Linux en un worker del ejército. No necesita librerías Python externas.

Variables mínimas:

- `CONTROL_PLANE_URL`: URL del Worker Cloudflare.
- `WORKER_TOKEN`: secreto de workers.
- `WORKER_ID`: identificador único del ejecutor.
- `WORKER_CAPABILITIES`: por ejemplo `browser,research,documents`.
- `EXECUTOR_COMMAND`: comando real que procesa el JSON del trabajo recibido por stdin.

Si `EXECUTOR_COMMAND` está vacío, el worker sólo hace heartbeat y no reclama trabajos. Esto evita consumir una licitación sin tener un ejecutor real conectado.

El comando ejecutor recibe además por variables de entorno el job id, worker id, URL del control plane y URL de checkpoint. Debe devolver JSON por stdout; por ejemplo, un objeto con `stage` y `result`.

## Estados

El ciclo base es:

`QUEUED -> RUNNING -> DONE`

Un fallo reanudable pasa a `RETRY`. Los trabajos también pueden quedar `FAILED` o `CANCELLED`.

Las etapas de negocio pueden evolucionar independientemente: `NUEVA`, `ANALIZANDO`, `COTIZANDO`, `AUDITANDO`, `LISTA PARA FIRMAR`, etc.

## Seguridad

El HTML del dashboard no contiene secretos. El token administrador se mantiene sólo en `sessionStorage` del navegador y se envía como Bearer token a la misma Worker API. Para producción es recomendable colocar además Cloudflare Access delante del Worker.

Los artefactos de R2 nunca son públicos: se descargan a través del Worker después de autenticación.

## Modelo económico

Esta arquitectura permite tener cientos de agentes lógicos definidos sin pagar cientos de computadoras. El costo real aparece cuando se encienden ejecutores para tareas con navegador, IA o CPU intensiva. Cuando no hay cola, esos ejecutores pueden apagarse o eliminarse.
