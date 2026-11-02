-- 1) Número de boleta normalizado (solo letras y dígitos en mayúscula) para impedir que una misma boleta
--    se use en más de una solicitud. El índice único parcial garantiza la regla incluso con envíos simultáneos.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS receipt_norm text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_requests_receipt_norm ON requests(receipt_norm) WHERE receipt_norm IS NOT NULL;

-- 2) Se retira el nivel "programa académico": las solicitudes se identifican por facultad y escuela.
--    La columna requests.program_id se conserva (nula) para no alterar el historial.
UPDATE programs SET active = false;
