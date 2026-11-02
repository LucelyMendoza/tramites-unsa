-- 001_init.sql — esquema base del sistema de trámites documentarios
-- gen_random_uuid() es nativo desde PostgreSQL 13.

CREATE TABLE faculties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id uuid NOT NULL REFERENCES faculties(id),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_schools_faculty ON schools(faculty_id);

CREATE TABLE programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_programs_school ON programs(school_id);

-- Catálogo administrable de tipos de trámite. config (jsonb) define campos, adjuntos y condiciones.
CREATE TABLE tramite_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  group_label text NOT NULL DEFAULT 'Pregrado',
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT '',
  firebase_uid text UNIQUE,
  applicant_type text NOT NULL DEFAULT 'estudiante' CHECK (applicant_type IN ('estudiante','egresado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- Roles internos. Se asignan SOLO por CLI/bootstrap del backend (nunca desde el navegador).
CREATE TABLE staff_roles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('superadmin','reviewer','issuer')),
  -- null => todas las facultades; lista de uuid => solo esas facultades
  faculty_scope jsonb,
  active boolean NOT NULL DEFAULT true,
  granted_by text NOT NULL DEFAULT 'cli',
  granted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,                       -- se asigna al enviar; nunca cambia (subsanación = mismo código)
  user_id uuid NOT NULL REFERENCES users(id),
  applicant_type text NOT NULL CHECK (applicant_type IN ('estudiante','egresado')),
  apellidos_nombres text NOT NULL,
  dni text NOT NULL,
  cui text NOT NULL,
  faculty_id uuid NOT NULL REFERENCES faculties(id),
  school_id uuid NOT NULL REFERENCES schools(id),
  program_id uuid REFERENCES programs(id),
  tramite_type_id uuid NOT NULL REFERENCES tramite_types(id),
  tramite_type_version int NOT NULL,
  type_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'BORRADOR' CHECK (status IN
    ('BORRADOR','ENVIADA','EN_REVISION','REQUIERE_SUBSANACION','REENVIADA','EN_TRAMITE','EMITIDA','FINALIZADA')),
  assigned_to uuid REFERENCES users(id),
  directory_check jsonb,
  resubmit_count int NOT NULL DEFAULT 0,
  -- campos que el solicitante editó desde la última observación de subsanación
  edited_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_requests_user ON requests(user_id, created_at DESC);
CREATE INDEX idx_requests_status ON requests(status, submitted_at DESC);
CREATE INDEX idx_requests_faculty_status ON requests(faculty_id, status);
CREATE INDEX idx_requests_school ON requests(school_id);
CREATE INDEX idx_requests_type ON requests(tramite_type_id);
CREATE INDEX idx_requests_dni ON requests(dni);
CREATE INDEX idx_requests_cui ON requests(cui);
CREATE INDEX idx_requests_assigned ON requests(assigned_to);
CREATE INDEX idx_requests_submitted ON requests(submitted_at);

CREATE TABLE request_counters (
  year int PRIMARY KEY,
  last_value int NOT NULL
);

-- Metadatos de archivos. El binario vive en R2 (o en disco local SOLO en desarrollo).
CREATE TABLE request_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id),
  slot text NOT NULL,                     -- BOLETA | DNI | (otros definidos en config)
  version int NOT NULL DEFAULT 0,         -- 0 mientras está pendiente; 1..n al verificarse
  object_key text NOT NULL UNIQUE,        -- clave aleatoria no predecible
  original_name text NOT NULL,
  declared_content_type text NOT NULL,
  detected_content_type text,
  size_bytes bigint NOT NULL,
  sha256 text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','superseded','rejected','purged')),
  is_current boolean NOT NULL DEFAULT false,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  purged_at timestamptz
);
CREATE INDEX idx_files_request ON request_files(request_id, slot, version);
CREATE UNIQUE INDEX uq_files_current_slot ON request_files(request_id, slot) WHERE is_current;

CREATE TABLE observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id),
  author_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('nota','subsanacion')),
  reason text NOT NULL,
  targets jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{type:'file',slot:'DNI'} | {type:'field',key:'cui'}]
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_obs_request ON observations(request_id, created_at);

CREATE TABLE status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id),
  from_status text,
  to_status text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hist_request ON status_history(request_id, created_at);

CREATE TABLE declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id),
  user_id uuid NOT NULL REFERENCES users(id),
  text_version text NOT NULL,
  text_snapshot text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  accepted_ip text,
  -- La aceptación NO equivale a autorización verificada. La verificación la registra el área responsable.
  verification_status text NOT NULL DEFAULT 'pendiente' CHECK (verification_status IN ('pendiente','verificada','rechazada')),
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  verification_note text
);
CREATE UNIQUE INDEX uq_declaration_request ON declarations(request_id);

CREATE TABLE issued_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id),
  version int NOT NULL,
  object_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','superseded','purged')),
  issued_by uuid NOT NULL REFERENCES users(id),
  issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_issued_request ON issued_documents(request_id);

-- Cola transaccional (outbox) de notificaciones por correo.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES requests(id),
  user_id uuid NOT NULL REFERENCES users(id),
  to_email text NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','dead')),
  attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX idx_notif_due ON notifications(status, next_attempt_at);
CREATE INDEX idx_notif_user ON notifications(user_id, created_at DESC);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id, created_at);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at)
