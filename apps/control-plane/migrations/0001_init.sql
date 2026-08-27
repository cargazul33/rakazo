PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  capability TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ONLINE',
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  expediente TEXT,
  organismo TEXT,
  closing_at TEXT,
  agent_name TEXT,
  required_capability TEXT NOT NULL DEFAULT 'research',
  priority INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  stage TEXT NOT NULL DEFAULT 'NUEVA',
  payload_json TEXT NOT NULL DEFAULT '{}',
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  approval_state TEXT NOT NULL DEFAULT 'pending',
  approval_notes TEXT NOT NULL DEFAULT '',
  lease_owner TEXT,
  lease_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (lease_owner) REFERENCES workers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_dispatch
  ON jobs(status, required_capability, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_expediente ON jobs(expediente);
CREATE INDEX IF NOT EXISTS idx_jobs_stage ON jobs(stage, status);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, id DESC);

INSERT OR IGNORE INTO agents (id, name, title, capability, description, system_prompt) VALUES
('general','GENERAL','Orquestador','orchestration','Coordina el ejército, reparte trabajo y controla checkpoints.','Coordiná trabajos pequeños, persistentes y reanudables. Nunca firmes, presentes, compres ni pagues sin aprobación humana.'),
('licitador','LICITADOR','Jefe de licitaciones','tender','Consolida cada licitación y prepara la oferta.','Procesá por fases: detectar, descargar, extraer, cotizar, calcular, auditar y documentar. PRECIO DE VENTA = COSTO REAL PUESTO × 1.90.'),
('detector','DETECTOR','Detector de oportunidades','research','Busca oportunidades vigentes.','Detectá oportunidades, organismo, expediente, cierre, URL y documentos. No inventes información.'),
('pliegos','PLIEGOS','Analista de pliegos','documents','Descarga y estructura pliegos y anexos.','Leé documentos completos y extraé renglones, cantidades, especificaciones, marcas, garantías y requisitos.'),
('precios-ar','PRECIOS ARGENTINA','Comprador Argentina','browser','Busca precios y stock en Argentina.','Buscá match técnico real, proveedor, URL, precio, stock, cantidad y entrega. Marcá RIESGO cuando no pueda verificarse.'),
('precios-py','PRECIOS PARAGUAY','Comprador Paraguay','browser','Busca precios y stock en Paraguay.','Buscá alternativas técnicamente compatibles y costo puesto. No supongas logística, impuestos ni stock.'),
('match','MATCH TÉCNICO','Validador técnico','analysis','Valida requisito contra producto.','Clasificá MATCH EXACTO, NO CUMPLE o RIESGO requisito por requisito.'),
('stock','STOCK','Validador de stock','browser','Revalida disponibilidad y plazo.','Confirmá stock suficiente, vigencia del precio y entrega dentro del plazo.'),
('costos','COSTOS','Motor económico','calculation','Calcula costo puesto y oferta.','Calculá COSTO REAL PUESTO y aplicá exactamente ×1.90 salvo autorización humana explícita.'),
('auditor','AUDITOR','Auditor final','audit','Audita cálculos, match, stock y documentación.','Hacé una segunda auditoría independiente y registrá errores y riesgos.'),
('documentador','DOCUMENTADOR','Documentación final','documents','Prepara LISTA PARA FIRMAR.','Consolidá evidencia verificada y generá la carpeta final. Nunca firmes ni presentes.');
