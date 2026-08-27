import type { Bot } from "@rakazo/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { rpc } from "../lib/rpc";

type Tab = "dashboard" | "agents" | "queue" | "approvals" | "health";
type QueueItem = {
  id: string;
  title: string;
  status: string;
  notes: string;
  updatedAt: string;
};
type ApprovalArtifact = {
  id: string;
  botId: string;
  botName: string;
  name: string;
  mimeType: string;
  createdAt?: string;
};

type RoleDefinition = {
  name: string;
  title: string;
  description: string;
  instruction: string;
};

const PROFIT_MULTIPLIER = 1.9;

const ROLES: RoleDefinition[] = [
  {
    name: "GENERAL",
    title: "Orquestador",
    description: "Coordina el ejército, reparte trabajos y controla checkpoints.",
    instruction:
      "Sos el ORQUESTADOR GENERAL. Coordiná a los agentes especializados, repartí tareas pequeñas y reanudables, evitá duplicaciones y exigí evidencia. Usá checkpoints persistentes. Nunca firmes, presentes, compres ni pagues sin aprobación humana. Priorizá oportunidades rentables y mantené una cola clara de trabajos.",
  },
  {
    name: "LICITADOR",
    title: "Jefe de licitaciones",
    description: "Consolida el expediente completo y prepara la oferta final.",
    instruction:
      "Procesá licitaciones por fases persistentes: detectar, descargar, extraer, cotizar, calcular, auditar y documentar. Regla comercial fija: PRECIO DE VENTA = COSTO REAL PUESTO × 1.90. El resultado final debe ser LISTA PARA FIRMAR. Nunca inventes datos ni hagas la presentación final.",
  },
  {
    name: "DETECTOR",
    title: "Detector de oportunidades",
    description: "Busca oportunidades vigentes y descarta las que no sirven.",
    instruction:
      "Revisá las fuentes configuradas, especialmente LICITARADARPRO y CODINEU. Detectá oportunidades vigentes de insumos, registrá organismo, expediente, cierre, enlaces y documentos disponibles. No cotices: entregá oportunidades estructuradas y priorizadas.",
  },
  {
    name: "PLIEGOS",
    title: "Analista de pliegos",
    description: "Descarga, lee y estructura pliegos, anexos y renglones.",
    instruction:
      "Descargá todos los documentos de cada oportunidad. Leé pliegos, anexos, circulares y formularios completos. Extraé renglones, cantidades, especificaciones, marcas obligatorias, fechas, garantías y requisitos administrativos. Guardá resultados estructurados y verificables.",
  },
  {
    name: "PRECIOS ARGENTINA",
    title: "Comprador Argentina",
    description: "Busca precio, stock, proveedor y evidencia en Argentina.",
    instruction:
      "Cotizá únicamente productos que cumplan exactamente el requisito técnico. Buscá en Argentina fabricantes, distribuidores, mayoristas, Mercado Libre y tiendas confiables. Registrá proveedor, link, precio, stock, cantidad disponible, entrega y fecha de verificación. Marcá RIESGO si algo no puede comprobarse.",
  },
  {
    name: "PRECIOS PARAGUAY",
    title: "Comprador Paraguay",
    description: "Busca alternativas y costo real puesto desde Paraguay.",
    instruction:
      "Buscá en Paraguay alternativas técnicamente compatibles. Registrá precio, stock, proveedor, link y evidencia. Calculá costos adicionales necesarios para obtener COSTO REAL PUESTO. No supongas importación, impuestos, logística ni stock: marcá como pendiente o RIESGO cuando no esté verificado.",
  },
  {
    name: "MATCH TÉCNICO",
    title: "Validador técnico",
    description: "Compara requisito contra producto punto por punto.",
    instruction:
      "Auditá cada renglón requisito por requisito. Clasificá MATCH EXACTO, NO CUMPLE o RIESGO. No aceptes equivalencias vagas. Verificá marca/modelo cuando sean obligatorios y dejá evidencia de cada conclusión.",
  },
  {
    name: "STOCK",
    title: "Validador de stock",
    description: "Confirma disponibilidad y plazo de entrega.",
    instruction:
      "Reverificá disponibilidad real, cantidad, plazo de entrega y vigencia del precio de los proveedores preseleccionados. Si no puede probarse stock suficiente o entrega dentro del plazo, marcá el renglón como RIESGO y no lo declares confirmado.",
  },
  {
    name: "COSTOS",
    title: "Motor económico",
    description: "Calcula costo puesto, oferta y diferencia económica.",
    instruction:
      "Calculá producto, envío, traslado, importación, impuestos y demás costos aplicables para obtener COSTO REAL PUESTO. Aplicá obligatoriamente PRECIO DE VENTA = COSTO REAL PUESTO × 1.90. Calculá unitarios, totales, oferta final y diferencia compra/venta. No cambies 1.90 sin autorización humana.",
  },
  {
    name: "AUDITOR",
    title: "Auditor final",
    description: "Detecta errores antes de que lleguen a aprobación humana.",
    instruction:
      "Hacé una segunda auditoría independiente de cantidades, especificaciones, match técnico, stock, links, precios, costos, multiplicador 1.90, fechas y documentación. No corrijas silenciosamente: registrá hallazgos, riesgos y bloqueos.",
  },
  {
    name: "DOCUMENTADOR",
    title: "Documentación final",
    description: "Arma la carpeta final y la LISTA PARA FIRMAR.",
    instruction:
      "Consolidá únicamente información ya verificada. Prepará presupuesto, planilla económica, detalle técnico, proveedores, links, evidencias y LISTA PARA FIRMAR. La lista debe incluir organismo, expediente, cierre, costo estimado, oferta, diferencia, renglones, match, stock, riesgos y documentos pendientes. Nunca firmes ni presentes.",
  },
];

const NORMALIZED_ROLE_NAMES = new Map(ROLES.map((role) => [normalize(role.name), role]));

export function AgentCommandCenterPage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [bots, setBots] = useState<Bot[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [apiVersion, setApiVersion] = useState<string>("—");

  const roleBots = useMemo(() => {
    const map = new Map<string, Bot>();
    for (const bot of bots) {
      const key = normalize(bot.name);
      if (NORMALIZED_ROLE_NAMES.has(key)) map.set(key, bot);
    }
    return map;
  }, [bots]);

  const general = roleBots.get(normalize("GENERAL"));
  const licitador = roleBots.get(normalize("LICITADOR"));

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [botList, health] = await Promise.all([rpc.bots.list(), rpc.health()]);
      setBots(botList);
      setApiVersion(health.version);

      const generalBot = botList.find((bot) => normalize(bot.name) === normalize("GENERAL"));
      if (generalBot) {
        const items = await rpc.scratchpad.list({ botId: generalBot.id, includeDone: true });
        setQueue(
          items.map((item) => ({
            id: item.id,
            title: item.title,
            status: item.status,
            notes: item.notes,
            updatedAt: item.updatedAt,
          })),
        );
      } else {
        setQueue([]);
      }

      const artifactBots = botList.filter((bot) =>
        ["LICITADOR", "DOCUMENTADOR", "AUDITOR"].includes(normalize(bot.name)),
      );
      const artifactLists = await Promise.all(
        artifactBots.map(async (bot) => ({
          bot,
          artifacts: await rpc.artifacts.list({ botId: bot.id }),
        })),
      );
      setApprovals(
        artifactLists.flatMap(({ bot, artifacts }) =>
          artifacts
            .filter((artifact) => /lista.*firmar|firmar|oferta|presupuesto/i.test(artifact.name))
            .map((artifact) => ({
              id: artifact.id,
              botId: bot.id,
              botName: bot.name,
              name: artifact.name,
              mimeType: artifact.mimeType,
            })),
        ),
      );
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createArmy() {
    setBusy("create-army");
    setError(null);
    setNotice(null);
    try {
      const current = await rpc.bots.list();
      const known = new Set(current.map((bot) => normalize(bot.name)));
      let created = 0;
      for (const role of ROLES) {
        if (known.has(normalize(role.name))) continue;
        const bot = await rpc.bots.create({
          name: role.name,
          title: role.title,
          description: role.description,
          instructions: role.instruction,
          notifyOnFinish: true,
          computerMode: "team",
        });
        created += 1;
        known.add(normalize(role.name));
        await rpc.threads.send({
          botId: bot.id,
          text: `${role.instruction}\n\nTrabajá en tareas pequeñas, persistentes y reanudables. Guardá evidencia y checkpoints. Cuando una dependencia no esté disponible, detenete con un estado claro en vez de improvisar.`,
          clientNonce: crypto.randomUUID(),
        });
      }
      setNotice(
        created === 0 ? "El ejército base ya estaba creado." : `Se crearon ${created} agentes.`,
      );
      await refresh();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  }

  async function dispatch(bot: Bot | undefined, text: string, key: string) {
    if (!bot) {
      setError("No existe el agente requerido. Creá el ejército base primero.");
      return;
    }
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await rpc.threads.send({ botId: bot.id, text, clientNonce: crypto.randomUUID() });
      setNotice(`Orden enviada a ${bot.name}.`);
      await refresh();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  }

  async function stopAgent(bot: Bot) {
    setBusy(`stop-${bot.id}`);
    setError(null);
    try {
      await rpc.threads.stop({ botId: bot.id });
      setNotice(`Tarea activa de ${bot.name} detenida.`);
      await refresh();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  }

  const activeRoles = ROLES.filter((role) => roleBots.has(normalize(role.name))).length;
  const missingRoles = ROLES.length - activeRoles;
  const workingBots = bots.filter((bot) =>
    /run|work|active|busy|thinking/i.test(bot.status),
  ).length;
  const openQueue = queue.filter((item) => item.status !== "done").length;

  return (
    <div className="min-h-full bg-[#060708] text-[#F5F5F6]">
      <header className="sticky top-0 z-20 border-b border-[#1B1D20] bg-[#090A0B]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 md:px-7">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7D838B]">
              Central operativa
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">
              Ejército de agentes
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-xl border border-[#26292D] bg-[#111315] px-3.5 py-2 text-sm font-medium hover:bg-[#17191C]"
            >
              Actualizar
            </button>
            <Link
              to="/app"
              className="rounded-xl border border-[#26292D] bg-[#111315] px-3.5 py-2 text-sm font-medium hover:bg-[#17191C]"
            >
              Rakazo
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 pb-28 pt-5 md:px-7 md:pb-10">
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          {(
            [
              ["dashboard", "Dashboard"],
              ["agents", "Agentes"],
              ["queue", "Cola"],
              ["approvals", "Para firmar"],
              ["health", "Salud"],
            ] as Array<[Tab, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                tab === value
                  ? "bg-[#F4F4F5] text-[#090A0B]"
                  : "bg-[#111315] text-[#9DA2A9] hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? <Banner tone="error">{error}</Banner> : null}
        {notice ? <Banner tone="success">{notice}</Banner> : null}

        {tab === "dashboard" ? (
          <section className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric
                label="Agentes definidos"
                value={`${activeRoles}/${ROLES.length}`}
                hint={missingRoles ? `${missingRoles} faltantes` : "Ejército completo"}
              />
              <Metric label="Trabajando ahora" value={workingBots} hint="según estado Rakazo" />
              <Metric
                label="Cola abierta"
                value={openQueue}
                hint={`${queue.length} trabajos registrados`}
              />
              <Metric
                label="Para firmar"
                value={approvals.length}
                hint="requiere decisión humana"
              />
              <Metric label="Regla comercial" value="× 1,90" hint="fija hasta autorización" />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
              <Card>
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div>
                    <Eyebrow>Acción principal</Eyebrow>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                      Procesar oportunidades rentables
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[#9BA0A7]">
                      El GENERAL coordina detección, pliegos, cotización, match, stock, costos,
                      auditoría y documentación. Cada agente trabaja por fases y deja checkpoints.
                    </p>
                  </div>
                  <StatusDot
                    ok={Boolean(general)}
                    label={general ? "GENERAL disponible" : "GENERAL faltante"}
                  />
                </div>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                  <PrimaryButton
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void dispatch(
                        general ?? licitador,
                        "Procesá todas las licitaciones vigentes y potencialmente rentables. Trabajá por cola y checkpoints. Usá todos los agentes especializados disponibles. Priorizá exactitud técnica, stock verificable, plazo y rentabilidad. Aplicá COSTO REAL PUESTO × 1.90. No firmes, no presentes y no pagues. Dejá cada expediente aprobado técnicamente en estado LISTA PARA FIRMAR y los demás como DESCARTADA, CON RIESGO o BLOQUEADA con motivo verificable.",
                        "process-all",
                      )
                    }
                  >
                    {busy === "process-all"
                      ? "Enviando…"
                      : "Procesar todas las licitaciones rentables"}
                  </PrimaryButton>
                  <SecondaryButton
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void dispatch(
                        general ?? licitador,
                        "Reanudá todos los trabajos interrumpidos desde su último checkpoint persistente. No reinicies trabajos ya completados. Antes de continuar verificá el estado actual y registrá qué se retoma.",
                        "resume-all",
                      )
                    }
                  >
                    {busy === "resume-all" ? "Enviando…" : "Reanudar interrumpidos"}
                  </SecondaryButton>
                </div>
              </Card>

              <Card>
                <Eyebrow>Infraestructura lógica</Eyebrow>
                <div className="mt-4 space-y-3">
                  <Row label="Agentes lógicos" value={`${activeRoles}`} />
                  <Row label="Pool recomendado" value="8 workers" />
                  <Row label="Computadora" value="Team / Docker" />
                  <Row label="Persistencia" value="Checkpoints" />
                  <Row label="Aprobación humana" value="Firma · presentación · pagos" />
                </div>
                <button
                  type="button"
                  disabled={Boolean(busy) || loading}
                  onClick={() => void createArmy()}
                  className="mt-5 w-full rounded-xl border border-[#2A2D31] bg-[#151719] px-4 py-3 text-sm font-semibold hover:bg-[#1B1E21] disabled:opacity-50"
                >
                  {busy === "create-army"
                    ? "Creando agentes…"
                    : missingRoles
                      ? `Crear ejército base (${missingRoles} faltantes)`
                      : "Ejército base completo"}
                </button>
              </Card>
            </div>

            <Card>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Eyebrow>Estado de roles</Eyebrow>
                  <h2 className="mt-1 text-lg font-semibold">Cadena de trabajo</h2>
                </div>
                <span className="text-xs text-[#71767D]">
                  {loading ? "actualizando…" : `${activeRoles} activos`}
                </span>
              </div>
              <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {ROLES.map((role, index) => {
                  const bot = roleBots.get(normalize(role.name));
                  return (
                    <div
                      key={role.name}
                      className="flex items-center gap-3 rounded-xl border border-[#1B1E21] bg-[#0D0F10] p-3.5"
                    >
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#171A1D] text-xs font-semibold text-[#B7BBC0]">
                        {String(index + 1).padStart(2, "0")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{role.name}</div>
                        <div className="truncate text-xs text-[#71767D]">
                          {bot ? bot.status || "disponible" : "no creado"}
                        </div>
                      </div>
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${bot ? "bg-emerald-400" : "bg-[#34383D]"}`}
                      />
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>
        ) : null}

        {tab === "agents" ? (
          <section className="space-y-3">
            {ROLES.map((role) => {
              const bot = roleBots.get(normalize(role.name));
              return (
                <Card key={role.name}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <div
                        className={`mt-1 h-3 w-3 shrink-0 rounded-full ${bot ? "bg-emerald-400" : "bg-[#34383D]"}`}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{role.name}</h3>
                          <span className="rounded-full bg-[#17191C] px-2 py-1 text-[11px] text-[#8D9299]">
                            {role.title}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[#8F949B]">{role.description}</p>
                        {bot ? (
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#656B72]">
                            <span>Estado: {bot.status || "—"}</span>
                            <span>Modelo: {bot.modelId || "default"}</span>
                            <span>Computer: {bot.computerMode}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {bot ? (
                        <>
                          <Link
                            to={`/app/${bot.id}`}
                            className="rounded-lg border border-[#292C30] px-3 py-2 text-xs font-semibold hover:bg-[#17191C]"
                          >
                            Abrir
                          </Link>
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void dispatch(
                                bot,
                                "Continuá tu trabajo pendiente desde el último checkpoint. Si no hay trabajo asignado, informá DISPONIBLE y no inventes una tarea.",
                                `run-${bot.id}`,
                              )
                            }
                            className="rounded-lg border border-[#292C30] px-3 py-2 text-xs font-semibold hover:bg-[#17191C] disabled:opacity-50"
                          >
                            Ejecutar
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => void stopAgent(bot)}
                            className="rounded-lg border border-[#4A2628] bg-[#1B1011] px-3 py-2 text-xs font-semibold text-[#E4A5A8] hover:bg-[#251315] disabled:opacity-50"
                          >
                            Detener
                          </button>
                        </>
                      ) : (
                        <span className="rounded-lg border border-[#26292D] px-3 py-2 text-xs text-[#777C83]">
                          Pendiente de creación
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </section>
        ) : null}

        {tab === "queue" ? (
          <section>
            <Card>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Eyebrow>GENERAL / scratchpad</Eyebrow>
                  <h2 className="mt-1 text-lg font-semibold">Cola persistente</h2>
                  <p className="mt-1 text-sm text-[#7F858C]">
                    Los trabajos deberían dividirse en unidades pequeñas y reanudables.
                  </p>
                </div>
                <span className="rounded-full bg-[#151719] px-3 py-1.5 text-xs text-[#9A9FA6]">
                  {openQueue} abiertos
                </span>
              </div>
              <div className="mt-5 divide-y divide-[#1B1E21]">
                {queue.length ? (
                  queue.map((item) => (
                    <div
                      key={item.id}
                      className="grid gap-2 py-4 md:grid-cols-[140px_1fr_180px] md:items-center"
                    >
                      <StatusPill status={item.status} />
                      <div>
                        <div className="text-sm font-semibold">{item.title}</div>
                        {item.notes ? (
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#747A81]">
                            {item.notes}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-xs text-[#636970] md:text-right">
                        {formatDate(item.updatedAt)}
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="No hay trabajos visibles en la cola"
                    body="Cuando GENERAL registre tareas en su scratchpad aparecerán acá."
                  />
                )}
              </div>
            </Card>
          </section>
        ) : null}

        {tab === "approvals" ? (
          <section>
            <Card>
              <Eyebrow>Intervención humana</Eyebrow>
              <h2 className="mt-1 text-lg font-semibold">LISTA PARA FIRMAR</h2>
              <p className="mt-1 text-sm text-[#7F858C]">
                Nada de esta bandeja debe firmarse, presentarse, comprarse o pagarse
                automáticamente.
              </p>
              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {approvals.length ? (
                  approvals.map((artifact) => (
                    <div
                      key={`${artifact.botId}-${artifact.id}`}
                      className="rounded-xl border border-[#23262A] bg-[#0D0F10] p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{artifact.name}</div>
                          <div className="mt-1 text-xs text-[#70767D]">
                            Generado por {artifact.botName}
                          </div>
                        </div>
                        <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[11px] font-semibold text-amber-300">
                          REVISAR
                        </span>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <Link
                          to={`/app/${artifact.botId}`}
                          className="rounded-lg bg-[#F1F1F2] px-3 py-2 text-xs font-semibold text-[#090A0B]"
                        >
                          Abrir expediente
                        </Link>
                        <button
                          type="button"
                          onClick={() =>
                            void dispatch(
                              bots.find((bot) => bot.id === artifact.botId),
                              `Reauditá el artefacto ${artifact.name}. No firmes ni presentes. Informá solamente inconsistencias, riesgos y qué necesita aprobación humana.`,
                              `reaudit-${artifact.id}`,
                            )
                          }
                          className="rounded-lg border border-[#2A2D31] px-3 py-2 text-xs font-semibold"
                        >
                          Pedir revisión
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="lg:col-span-2">
                    <EmptyState
                      title="Todavía no hay ofertas para firmar"
                      body="Los artefactos de LICITADOR, AUDITOR o DOCUMENTADOR aparecerán acá cuando tengan nombres relacionados con oferta, presupuesto o firma."
                    />
                  </div>
                )}
              </div>
            </Card>
          </section>
        ) : null}

        {tab === "health" ? (
          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <Eyebrow>Rakazo</Eyebrow>
              <div className="mt-4 space-y-3">
                <Row label="API" value={error ? "con error" : "conectada"} />
                <Row label="Versión" value={apiVersion} />
                <Row label="Bots totales" value={`${bots.length}`} />
                <Row label="Roles del ejército" value={`${activeRoles}/${ROLES.length}`} />
                <Row label="Modo recomendado" value="Team computer" />
              </div>
            </Card>
            <Card>
              <Eyebrow>Límites operativos</Eyebrow>
              <div className="mt-4 space-y-3">
                <Row label="Workers normales" value="8" />
                <Row label="Multiplicador" value={`× ${PROFIT_MULTIPLIER.toFixed(2)}`} />
                <Row label="Firma automática" value="Bloqueada" />
                <Row label="Presentación automática" value="Bloqueada" />
                <Row label="Pagos automáticos" value="Bloqueados" />
              </div>
            </Card>
            <Card>
              <Eyebrow>Próxima integración</Eyebrow>
              <p className="mt-3 text-sm leading-6 text-[#8D9299]">
                CPU, RAM, contenedores Docker, profundidad real de la cola y workers concurrentes
                requieren métricas del servidor. La pantalla ya queda preparada para incorporarlas
                cuando el nuevo VPS esté instalado.
              </p>
            </Card>
            <Card>
              <Eyebrow>Principio de estabilidad</Eyebrow>
              <p className="mt-3 text-sm leading-6 text-[#8D9299]">
                Muchos agentes lógicos, pocos workers simultáneos. Cada tarea debe persistir estado
                y reanudarse desde el último checkpoint en vez de depender de un análisis
                conversacional largo.
              </p>
            </Card>
          </section>
        ) : null}
      </main>

      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 gap-1 rounded-2xl border border-[#25282C] bg-[#0E1012]/95 p-1.5 shadow-2xl backdrop-blur md:hidden">
        {(
          [
            ["dashboard", "Inicio"],
            ["agents", "Agentes"],
            ["queue", "Cola"],
            ["approvals", "Firmar"],
            ["health", "Salud"],
          ] as Array<[Tab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-xl px-2 py-2.5 text-[11px] font-semibold ${tab === value ? "bg-[#F0F0F1] text-black" : "text-[#8B9097]"}`}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#202327] bg-[#0B0D0E] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.18)] md:p-5">
      {children}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-2xl border border-[#202327] bg-[#0B0D0E] p-4">
      <div className="text-xs text-[#747A81]">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-[#5F656C]">{hint}</div>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6F757C]">
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#1A1D20] pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-[#7D838A]">{label}</span>
      <span className="text-right text-sm font-semibold text-[#D9DBDE]">{value}</span>
    </div>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-[#24272B] bg-[#101214] px-3 py-1.5 text-xs text-[#90959C]">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
      {label}
    </div>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-xl bg-[#F3F3F4] px-4 py-3 text-sm font-semibold text-[#08090A] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-xl border border-[#2A2D31] bg-[#121416] px-4 py-3 text-sm font-semibold hover:bg-[#191B1E] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone: "error" | "success" }) {
  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 text-sm ${tone === "error" ? "border-red-900/60 bg-red-950/30 text-red-200" : "border-emerald-900/60 bg-emerald-950/20 text-emerald-200"}`}
    >
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const done = status === "done";
  const parked = status === "parked";
  return (
    <span
      className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${done ? "bg-emerald-400/10 text-emerald-300" : parked ? "bg-amber-400/10 text-amber-300" : "bg-sky-400/10 text-sky-300"}`}
    >
      {status}
    </span>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#2A2D31] px-5 py-10 text-center">
      <div className="text-sm font-semibold text-[#C8CBD0]">{title}</div>
      <div className="mx-auto mt-2 max-w-xl text-xs leading-5 text-[#6F757C]">{body}</div>
    </div>
  );
}

function normalize(value: string) {
  return value.trim().toUpperCase();
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(date);
}
