-- Responsable por tipo de trámite: toda solicitud enviada se asigna automáticamente a esta persona.
CREATE TABLE IF NOT EXISTS assignment_rules (
  tramite_type_id uuid PRIMARY KEY REFERENCES tramite_types(id),
  assignee_id uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ausencias (vacaciones, licencias): mientras estén vigentes, lo que llegue al titular se deriva al suplente.
ALTER TABLE staff_roles ADD COLUMN IF NOT EXISTS away_from date;
ALTER TABLE staff_roles ADD COLUMN IF NOT EXISTS away_until date;
ALTER TABLE staff_roles ADD COLUMN IF NOT EXISTS away_note text;
ALTER TABLE staff_roles ADD COLUMN IF NOT EXISTS substitute_id uuid REFERENCES users(id);
