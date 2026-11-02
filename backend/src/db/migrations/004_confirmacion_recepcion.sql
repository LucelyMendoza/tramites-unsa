-- Encuesta obligatoria al solicitante: "¿Le llegó correctamente el documento?" (una respuesta por versión emitida).
CREATE TABLE IF NOT EXISTS receipt_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id),
  issued_document_id uuid NOT NULL UNIQUE REFERENCES issued_documents(id),
  answer text NOT NULL CHECK (answer IN ('si','no')),
  message text,
  answered_by uuid NOT NULL REFERENCES users(id),
  answered_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,           -- el personal reenvió un documento corregido
  resolved_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_receipt_request ON receipt_confirmations(request_id, answered_at);
