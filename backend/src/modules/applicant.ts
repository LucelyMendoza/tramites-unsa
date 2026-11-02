import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import type { Queryable } from '../db/index.js';
import { APPLICANT_EDITABLE } from '../domain/stateMachine.js';
import { inScope, can } from '../domain/permissions.js';
import { DECLARATION_TEXT, parseConfig, uniqueReceiptOf, validateTypeData, type TramiteConfig } from '../domain/tramiteConfig.js';
import { normalizeName, validCui, validDni, validFullName } from '../domain/validators.js';
import { finalizeUnmet, receiptState } from '../domain/receipt.js';
import { enqueue } from '../notifications/outbox.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../errors.js';
import { MIME_BY_KIND, kindFromMime, kindFromName, verifyContent, type Kind } from '../storage/fileSniff.js';
import { newObjectKey } from '../storage/index.js';
import {
  applyTransition,
  audit,
  editableTargets,
  getType,
  loadDetail,
  lockRequest,
  nextCode,
  type AuthUser,
} from './service.js';

const uuid = z.string().uuid();

const requestBody = z.object({
  applicantType: z.enum(['estudiante', 'egresado']),
  apellidosNombres: z.string(),
  dni: z.string(),
  cui: z.string(),
  facultyId: uuid,
  schoolId: uuid,
  programId: uuid.nullable().optional(),
  tramiteTypeId: uuid,
  typeData: z.record(z.string(), z.unknown()).default({}),
});
type RequestBody = z.infer<typeof requestBody>;

const MAX_PENDING_UPLOADS = 20;

export const applicantRoutes: FastifyPluginAsync<Deps> = async (app, deps) => {
  const { cfg, db, storage } = deps;
  const directory = deps.directory!;

  /**
   * Apellidos y nombres: se toman de la cuenta institucional con la que inició sesión (Google Workspace),
   * no de lo que envíe el navegador. Solo si la cuenta no trae nombre se acepta el escrito por el usuario.
   */
  async function validateBody(q: Queryable, b: RequestBody, user: AuthUser, keepName?: string) {
    const errors: Record<string, string> = {};
    const fromAccount = normalizeName(user.name ?? '');
    const name = keepName ?? (fromAccount || normalizeName(b.apellidosNombres));
    if (!name) errors.apellidosNombres = 'Su cuenta no tiene nombre registrado: escriba sus apellidos y nombres';
    else if (!keepName && !fromAccount && !validFullName(name)) errors.apellidosNombres = 'Ingrese Apellidos y Nombres completos (solo letras)';
    if (!b.dni.trim()) errors.dni = 'El DNI es obligatorio';
    else if (!validDni(b.dni.trim())) errors.dni = 'El DNI debe tener 8 dígitos';
    if (!b.cui.trim()) errors.cui = 'El CUI es obligatorio';
    else if (!validCui(b.cui.trim(), cfg)) errors.cui = 'El CUI no tiene el formato esperado';

    const school = (await q.query<any>(`SELECT id,faculty_id FROM schools WHERE id=$1 AND active`, [b.schoolId]))[0];
    const faculty = (await q.query<any>(`SELECT id FROM faculties WHERE id=$1 AND active`, [b.facultyId]))[0];
    if (!faculty) errors.facultyId = 'Facultad no válida';
    if (!school || school.faculty_id !== b.facultyId) errors.schoolId = 'La escuela no pertenece a la facultad seleccionada';
    const type = (await q.query<any>(`SELECT * FROM tramite_types WHERE id=$1 AND active`, [b.tramiteTypeId]))[0];
    let cfgType: TramiteConfig | undefined;
    let clean: Record<string, unknown> = {};
    if (!type) errors.tramiteTypeId = 'Tipo de trámite no disponible';
    else {
      cfgType = parseConfig(type.config);
      const td = validateTypeData(cfgType, b.typeData);
      if (!td.ok) for (const [k, v] of Object.entries(td.errors)) errors[`typeData.${k}`] = v;
      else clean = td.clean;
    }
    if (Object.keys(errors).length) throw unprocessable('Revise los datos del formulario', errors);
    return { name, clean, type, cfgType: cfgType!, receipt: uniqueReceiptOf(cfgType!, clean) };
  }

  /** Una boleta solo puede sustentar UNA solicitud (de cualquier tipo y de cualquier usuario). */
  async function assertReceiptFree(q: Queryable, receipt: { key: string; norm: string } | null, user: AuthUser, selfId: string | null) {
    if (!receipt) return;
    const other = (await q.query<any>(`SELECT id,code,user_id FROM requests WHERE receipt_norm=$1 AND ($2::uuid IS NULL OR id<>$2::uuid)`, [receipt.norm, selfId]))[0];
    if (!other) return;
    // A otro usuario no se le revela a qué solicitud pertenece la boleta.
    const msg = other.user_id === user.id
      ? `Ya usó este número de boleta en su solicitud ${other.code ?? '(borrador pendiente de envío)'}. Cada boleta sustenta un solo trámite.`
      : 'Este número de boleta ya fue registrado en otra solicitud. Verifique el número o comuníquese con la DSA.';
    throw unprocessable('Número de boleta ya utilizado', { [`typeData.${receipt.key}`]: msg });
  }

  /** Traduce la violación del índice único (envíos simultáneos) al mismo error funcional. */
  async function guardReceipt<T>(receiptKey: () => string | null | undefined, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      const key = receiptKey();
      if (key && (e?.code === '23505' || /uq_requests_receipt_norm/.test(String(e?.message))))
        throw unprocessable('Número de boleta ya utilizado', { [`typeData.${key}`]: 'Este número de boleta ya fue registrado en otra solicitud.' });
      throw e;
    }
  }

  function ownsOr404(row: any, user: AuthUser) {
    if (!row || row.user_id !== user.id) throw notFound('Solicitud no encontrada');
  }

  // ---------- Crear borrador ----------
  app.post('/api/requests', async (req, reply) => {
    const user = req.user!;
    const b = requestBody.parse(req.body);
    const v = await validateBody(db, b, user);
    await assertReceiptFree(db, v.receipt, user, null);
    const dir = await directory.check({ dni: b.dni.trim(), cui: b.cui.trim(), fullName: v.name });
    const id = await guardReceipt(() => v.receipt?.key, () => db.tx(async (q) => {
      const r = await q.query<any>(
        `INSERT INTO requests(user_id,applicant_type,apellidos_nombres,dni,cui,faculty_id,school_id,program_id,tramite_type_id,tramite_type_version,type_data,directory_check,receipt_norm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10::jsonb,$11::jsonb,$12) RETURNING id`,
        [user.id, b.applicantType, v.name, b.dni.trim(), b.cui.trim(), b.facultyId, b.schoolId, b.tramiteTypeId, v.type.version, JSON.stringify(v.clean), JSON.stringify(dir), v.receipt?.norm ?? null],
      );
      await audit(q, user, 'request.draft_create', 'request', r[0].id, { tramiteTypeId: b.tramiteTypeId }, req.ip);
      return r[0].id as string;
    }));
    return reply.status(201).send({ id });
  });

  // ---------- Actualizar (borrador o subsanación) ----------
  app.put('/api/requests/:id', async (req) => {
    const user = req.user!;
    const id = uuid.parse((req.params as any).id);
    const b = requestBody.parse(req.body);
    let receiptRef: { key: string } | null = null;
    return guardReceipt(() => receiptRef?.key, () => db.tx(async (q) => {
      const cur = await lockRequest(q, id);
      ownsOr404(cur, user);
      if (!APPLICANT_EDITABLE.includes(cur.status)) throw conflict('La solicitud no se puede modificar en su estado actual');

      if (cur.status === 'REQUIERE_SUBSANACION' && b.tramiteTypeId !== cur.tramite_type_id)
        throw forbidden('El tipo de trámite no puede cambiarse en una subsanación');

      // En subsanación se conserva el nombre registrado; en borrador se refresca desde la cuenta.
      const v = await validateBody(q, b, user, cur.status === 'BORRADOR' ? undefined : cur.apellidos_nombres);
      receiptRef = v.receipt;
      await assertReceiptFree(q, v.receipt, user, id);
      const prevTd = cur.type_data as Record<string, unknown>;
      const changed: string[] = [];
      const cmp = (k: string, a: unknown, c: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(c ?? null) && changed.push(k);
      cmp('apellidos_nombres', cur.apellidos_nombres, v.name);
      cmp('dni', cur.dni, b.dni.trim());
      cmp('cui', cur.cui, b.cui.trim());
      cmp('faculty_id', cur.faculty_id, b.facultyId);
      cmp('school_id', cur.school_id, b.schoolId);
      for (const k of new Set([...Object.keys(prevTd), ...Object.keys(v.clean)])) cmp(`td.${k}`, prevTd[k], v.clean[k]);

      if (cur.status === 'REQUIERE_SUBSANACION') {
        const ed = await editableTargets(q, id);
        const denied = changed.filter((k) => !ed.all && !ed.fields.has(k));
        if (denied.length) throw forbidden(`Solo puede modificar los campos observados. No permitido: ${denied.join(', ')}`);
      }
      const dir = await directory.check({ dni: b.dni.trim(), cui: b.cui.trim(), fullName: v.name });
      const edited = [...new Set([...(cur.edited_fields as string[]), ...changed])];
      await q.query(
        `UPDATE requests SET applicant_type=$2,apellidos_nombres=$3,dni=$4,cui=$5,faculty_id=$6,school_id=$7,program_id=NULL,
           tramite_type_id=$8,tramite_type_version=$9,type_data=$10::jsonb,directory_check=$11::jsonb,edited_fields=$12::jsonb,receipt_norm=$13,updated_at=now() WHERE id=$1`,
        [id, b.applicantType, v.name, b.dni.trim(), b.cui.trim(), b.facultyId, b.schoolId, b.tramiteTypeId, v.type.version, JSON.stringify(v.clean), JSON.stringify(dir), JSON.stringify(edited), v.receipt?.norm ?? null],
      );
      await audit(q, user, 'request.update', 'request', id, { changed }, req.ip);
      return { ok: true, changed };
    }));
  });

  // ---------- Listado propio ----------
  app.get('/api/requests', async (req) => {
    const q = z.object({ page: z.coerce.number().min(1).default(1), pageSize: z.coerce.number().min(1).max(50).default(10) }).parse(req.query);
    const total = (await db.query<any>(`SELECT count(*)::int AS n FROM requests WHERE user_id=$1`, [req.user!.id]))[0].n;
    const rows = await db.query<any>(
      `SELECT r.id,r.code,r.status,r.created_at,r.submitted_at,r.updated_at,t.name AS tramite_name
         FROM requests r JOIN tramite_types t ON t.id=r.tramite_type_id
        WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
      [req.user!.id, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({ id: r.id, code: r.code, status: r.status, tramiteName: r.tramite_name, createdAt: r.created_at, submittedAt: r.submitted_at, updatedAt: r.updated_at })),
    };
  });

  app.get('/api/requests/:id', async (req) => {
    const id = uuid.parse((req.params as any).id);
    const own = (await db.query<any>(`SELECT user_id FROM requests WHERE id=$1`, [id]))[0];
    ownsOr404(own, req.user!);
    const d = await loadDetail(db, id, 'applicant', req.user!.id);
    const ed = d.status === 'REQUIERE_SUBSANACION' ? await editableTargets(db, id) : null;
    return {
      ...d,
      editable: ed
        ? { all: ed.all, files: [...ed.files], fields: [...ed.fields] }
        : d.status === 'BORRADOR'
          ? { all: true, files: [], fields: [] }
          : null,
    };
  });

  // ---------- Archivos: autorizar carga ----------
  const presignBody = z.object({ slot: z.string(), filename: z.string().min(1).max(200), size: z.number().int().positive(), contentType: z.string() });

  async function assertSlotEditable(q: Queryable, r: any, slot: string) {
    if (!APPLICANT_EDITABLE.includes(r.status)) throw conflict('No se pueden cargar archivos en el estado actual de la solicitud');
    if (r.status === 'REQUIERE_SUBSANACION') {
      const ed = await editableTargets(q, r.id);
      if (!ed.all && !ed.files.has(slot)) throw forbidden('Este documento no fue observado; solo puede reemplazar los documentos indicados');
    }
  }

  app.post('/api/requests/:id/files/presign', async (req) => {
    const user = req.user!;
    const id = uuid.parse((req.params as any).id);
    const b = presignBody.parse(req.body);
    const r = (await db.query<any>(`SELECT * FROM requests WHERE id=$1`, [id]))[0];
    ownsOr404(r, user);
    const { config } = await getType(db, r.tramite_type_id);
    const doc = config.requiredDocs.find((d) => d.slot === b.slot);
    if (!doc) throw badRequest('Documento no válido para este trámite');
    await assertSlotEditable(db, r, b.slot);

    const maxBytes = Math.min(doc.maxMb ?? cfg.MAX_FILE_MB, cfg.MAX_FILE_MB) * 1024 * 1024;
    if (b.size > maxBytes) throw unprocessable(`El archivo excede el máximo de ${maxBytes / 1024 / 1024} MB`);
    const byName = kindFromName(b.filename);
    const byMime = kindFromMime(b.contentType);
    if (!byName || !byMime || byName !== byMime || !doc.kinds.includes(byName))
      throw unprocessable(`Formato no permitido. Use: ${doc.kinds.map((k) => k.toUpperCase()).join(', ')}`);
    const pending = (await db.query<any>(`SELECT count(*)::int AS n FROM request_files WHERE request_id=$1 AND status='pending'`, [id]))[0].n;
    if (pending >= MAX_PENDING_UPLOADS) throw new HttpError(429, 'Demasiadas cargas pendientes');

    const key = newObjectKey('att');
    const row = (
      await db.query<any>(
        `INSERT INTO request_files(request_id,slot,object_key,original_name,declared_content_type,size_bytes,uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [id, b.slot, key, b.filename.replace(/[\r\n"\\/]/g, '_'), MIME_BY_KIND[byName], b.size, user.id],
      )
    )[0];
    const signed = await storage.signUpload(key, MIME_BY_KIND[byName], b.size, cfg.PRESIGN_UPLOAD_TTL_SECONDS);
    await audit(db, user, 'file.presign_upload', 'request', id, { fileId: row.id, slot: b.slot, size: b.size }, req.ip);
    return { fileId: row.id, upload: signed };
  });

  // ---------- Archivos: confirmar carga (validación de contenido real) ----------
  app.post('/api/requests/:id/files/:fileId/complete', async (req) => {
    const user = req.user!;
    const id = uuid.parse((req.params as any).id);
    const fileId = uuid.parse((req.params as any).fileId);
    const r = (await db.query<any>(`SELECT * FROM requests WHERE id=$1`, [id]))[0];
    ownsOr404(r, user);
    const f = (await db.query<any>(`SELECT * FROM request_files WHERE id=$1 AND request_id=$2 AND uploaded_by=$3`, [fileId, id, user.id]))[0];
    if (!f) throw notFound('Archivo no encontrado');
    if (f.status !== 'pending') throw conflict('El archivo ya fue procesado');
    await assertSlotEditable(db, r, f.slot);
    const { config } = await getType(db, r.tramite_type_id);
    const doc = config.requiredDocs.find((d) => d.slot === f.slot)!;
    const maxBytes = Math.min(doc.maxMb ?? cfg.MAX_FILE_MB, cfg.MAX_FILE_MB) * 1024 * 1024;

    const reject = async (reason: string) => {
      await storage.delete(f.object_key).catch(() => {});
      await db.query(`UPDATE request_files SET status='rejected' WHERE id=$1`, [fileId]);
      await audit(db, user, 'file.rejected', 'request', id, { fileId, reason }, req.ip);
      throw unprocessable(reason);
    };

    const head = await storage.head(f.object_key);
    if (!head) throw conflict('El archivo todavía no se subió al almacenamiento');
    if (head.size !== Number(f.size_bytes) || head.size > maxBytes) return reject('El tamaño del archivo subido no coincide con lo declarado o excede el máximo');
    let buf: Buffer;
    try {
      buf = await storage.read(f.object_key, maxBytes);
    } catch {
      return reject('No se pudo leer el archivo subido');
    }
    const ver = verifyContent(buf, doc.kinds as Kind[], f.original_name, f.declared_content_type);
    if (!ver.ok) return reject(ver.reason!);

    await db.tx(async (q) => {
      const cur = await lockRequest(q, id);
      await assertSlotEditable(q, cur, f.slot);
      const v = (await q.query<any>(`SELECT COALESCE(max(version),0)+1 AS v FROM request_files WHERE request_id=$1 AND slot=$2`, [id, f.slot]))[0].v;
      await q.query(`UPDATE request_files SET is_current=false, status='superseded' WHERE request_id=$1 AND slot=$2 AND is_current`, [id, f.slot]);
      await q.query(
        `UPDATE request_files SET status='verified', is_current=true, version=$2, detected_content_type=$3, sha256=$4, verified_at=now() WHERE id=$1`,
        [fileId, v, MIME_BY_KIND[ver.detected!], ver.sha256],
      );
      await audit(q, user, 'file.verified', 'request', id, { fileId, slot: f.slot, version: v, sha256: ver.sha256 }, req.ip);
    });
    return { ok: true, fileId };
  });

  // ---------- Envío / reenvío ----------
  app.post('/api/requests/:id/submit', async (req) => {
    const user = req.user!;
    const id = uuid.parse((req.params as any).id);
    const body = z.object({ declarationAccepted: z.boolean().optional() }).strict().parse(req.body ?? {});
    return db.tx(async (q) => {
      const r = await lockRequest(q, id);
      ownsOr404(r, user);
      if (!APPLICANT_EDITABLE.includes(r.status)) throw conflict('La solicitud ya fue enviada');
      const { config } = await getType(q, r.tramite_type_id);
      const files = await q.query<any>(`SELECT slot,verified_at FROM request_files WHERE request_id=$1 AND is_current AND status='verified'`, [id]);
      const missing = config.requiredDocs.filter((d) => !files.some((f) => f.slot === d.slot)).map((d) => d.label);
      if (missing.length) throw unprocessable('Faltan documentos obligatorios', { missing });

      if (r.status === 'BORRADOR') {
        if (config.requiresDeclaration) {
          if (body.declarationAccepted !== true) throw unprocessable('Debe marcar la declaración jurada para continuar', { declaration: 'Obligatoria' });
          await q.query(
            `INSERT INTO declarations(request_id,user_id,text_version,text_snapshot,accepted_ip) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (request_id) DO NOTHING`,
            [id, user.id, config.declarationVersion, DECLARATION_TEXT, req.ip],
          );
          await audit(q, user, 'declaration.accepted', 'request', id, { version: config.declarationVersion }, req.ip);
        }
        const code = await nextCode(q);
        await q.query(`UPDATE requests SET code=$2, submitted_at=now() WHERE id=$1`, [id, code]);
        await applyTransition(q, { request: { ...r, code }, to: 'ENVIADA', actorKind: 'applicant', actor: user, cfg });
        return { id, code, status: 'ENVIADA' };
      }

      // REQUIERE_SUBSANACION → REENVIADA (mismo expediente, mismo código)
      const obs = await q.query<any>(`SELECT id,targets,created_at FROM observations WHERE request_id=$1 AND kind='subsanacion' AND resolved_at IS NULL`, [id]);
      const pendingFix: string[] = [];
      const edited = new Set(r.edited_fields as string[]);
      for (const o of obs) {
        const targets = o.targets as { type: string; key: string }[];
        const fileSince = files.some((f) => new Date(f.verified_at) > new Date(o.created_at));
        if (targets.length === 0 && !fileSince && edited.size === 0) pendingFix.push('Realice al menos una corrección');
        for (const t of targets) {
          if (t.type === 'file' && !files.some((f) => f.slot === t.key && new Date(f.verified_at) > new Date(o.created_at))) pendingFix.push(`Reemplace el documento: ${t.key}`);
          if (t.type === 'field' && !edited.has(t.key)) pendingFix.push(`Corrija el campo: ${t.key}`);
        }
      }
      if (pendingFix.length) throw unprocessable('Aún no subsanó todas las observaciones', { pending: [...new Set(pendingFix)] });
      await q.query(`UPDATE observations SET resolved_at=now() WHERE request_id=$1 AND kind='subsanacion' AND resolved_at IS NULL`, [id]);
      await q.query(`UPDATE requests SET resubmit_count=resubmit_count+1 WHERE id=$1`, [id]);
      await applyTransition(q, { request: r, to: 'REENVIADA', actorKind: 'applicant', actor: user, cfg });
      return { id, code: r.code, status: 'REENVIADA' };
    });
  });

  // ---------- Encuesta obligatoria: ¿le llegó correctamente el documento? ----------
  app.get('/api/me/pending-receipts', async (req) => {
    const rows = await db.query<any>(
      `SELECT r.id,r.code,t.name AS tramite_name,d.id AS doc_id,d.original_name
         FROM requests r JOIN tramite_types t ON t.id=r.tramite_type_id
         JOIN issued_documents d ON d.request_id=r.id AND d.status='verified'
        WHERE r.user_id=$1 AND r.status='EMITIDA'
          AND NOT EXISTS (SELECT 1 FROM receipt_confirmations c WHERE c.issued_document_id=d.id)
        ORDER BY r.updated_at`,
      [req.user!.id],
    );
    return rows.map((r) => ({ requestId: r.id, code: r.code, tramiteName: r.tramite_name, docId: r.doc_id, fileName: r.original_name }));
  });

  app.post('/api/requests/:id/receipt', async (req) => {
    const user = req.user!;
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ answer: z.enum(['si', 'no']), message: z.string().trim().max(1000).optional() }).strict().parse(req.body);
    if (b.answer === 'no' && (b.message ?? '').length < 5)
      throw unprocessable('Cuéntenos qué problema tiene el documento', { message: 'Describa el problema (mínimo 5 caracteres)' });
    return db.tx(async (q) => {
      const r = await lockRequest(q, id);
      ownsOr404(r, user);
      if (r.status !== 'EMITIDA') throw conflict('Esta solicitud no tiene un documento pendiente de confirmar');
      const rc = await receiptState(q, id, r.status);
      if (!rc.pending) throw conflict('Ya respondió por este documento');
      await q.query(
        `INSERT INTO receipt_confirmations(request_id,issued_document_id,answer,message,answered_by) VALUES ($1,$2,$3,$4,$5)`,
        [id, rc.currentDocId, b.answer, b.answer === 'no' ? b.message : null, user.id],
      );
      await audit(q, user, 'receipt.answer', 'request', id, { answer: b.answer, docId: rc.currentDocId }, req.ip);
      if (b.answer === 'si') {
        // Confirmado: el trámite se cierra solo si no queda otra condición pendiente (p. ej. verificación de posgrado).
        const { config } = await getType(q, r.tramite_type_id);
        if ((await finalizeUnmet(q, id, config)).length === 0) {
          await applyTransition(q, { request: r, to: 'FINALIZADA', actorKind: 'applicant', actor: user, cfg, payloadExtra: { hasIssuedDocument: true } });
          await q.query(`UPDATE requests SET finalized_at=now() WHERE id=$1`, [id]);
          return { ok: true, status: 'FINALIZADA' };
        }
        return { ok: true, status: 'EMITIDA' };
      }
      // "No": se avisa al responsable asignado (o al emisor que cargó el documento) para que lo corrija.
      const staff = (
        await q.query<any>(
          `SELECT u.id,u.email,u.display_name FROM users u
            WHERE u.id = COALESCE($1::uuid, (SELECT issued_by FROM issued_documents WHERE id=$2))`,
          [r.assigned_to, rc.currentDocId],
        )
      )[0];
      if (staff) {
        const type = (await q.query<any>(`SELECT name FROM tramite_types WHERE id=$1`, [r.tramite_type_id]))[0];
        await enqueue(q, {
          requestId: id, userId: staff.id, toEmail: staff.email, event: 'RECEPCION_OBSERVADA', dedupeSuffix: rc.currentDocId!,
          payload: { code: r.code, name: staff.display_name || undefined, tramite: type?.name, reason: b.message, link: `${cfg.APP_URL}/admin/solicitud/${id}` },
        });
      }
      return { ok: true, status: 'EMITIDA' };
    });
  });

  // ---------- Descargas (URL prefirmada de corta duración) ----------
  async function authorizeRequestAccess(user: AuthUser, r: any) {
    if (r.user_id === user.id) return 'owner' as const;
    if (user.staff && can(user.staff.role, 'request:view') && inScope(user.staff.scope, r.faculty_id) && r.status !== 'BORRADOR') return 'staff' as const;
    throw notFound('No encontrado');
  }

  // ?mode=inline → vista previa en el navegador · ?mode=attachment (por defecto) → descarga. Ambas quedan auditadas.
  const modeOf = (req: any) => z.object({ mode: z.enum(['inline', 'attachment']).default('attachment') }).parse(req.query ?? {}).mode;

  app.get('/api/files/:fileId/download-url', async (req) => {
    const user = req.user!;
    const fileId = uuid.parse((req.params as any).fileId);
    const mode = modeOf(req);
    const row = (
      await db.query<any>(
        `SELECT f.*, r.user_id, r.faculty_id, r.status AS req_status FROM request_files f JOIN requests r ON r.id=f.request_id WHERE f.id=$1`,
        [fileId],
      )
    )[0];
    if (!row) throw notFound();
    await authorizeRequestAccess(user, { user_id: row.user_id, faculty_id: row.faculty_id, status: row.req_status });
    if (!['verified', 'superseded'].includes(row.status)) throw notFound();
    const url = await storage.signDownload(row.object_key, row.original_name, row.detected_content_type, cfg.PRESIGN_DOWNLOAD_TTL_SECONDS, mode);
    await audit(db, user, mode === 'inline' ? 'file.view' : 'file.download', 'request', row.request_id, { fileId, slot: row.slot, version: row.version }, req.ip);
    return { url, expiresInSeconds: cfg.PRESIGN_DOWNLOAD_TTL_SECONDS, mode, filename: row.original_name, contentType: row.detected_content_type };
  });

  app.get('/api/issued/:docId/download-url', async (req) => {
    const user = req.user!;
    const docId = uuid.parse((req.params as any).docId);
    const mode = modeOf(req);
    const row = (
      await db.query<any>(
        `SELECT d.*, r.user_id, r.faculty_id, r.status AS req_status FROM issued_documents d JOIN requests r ON r.id=d.request_id WHERE d.id=$1`,
        [docId],
      )
    )[0];
    if (!row) throw notFound();
    const who = await authorizeRequestAccess(user, { user_id: row.user_id, faculty_id: row.faculty_id, status: row.req_status });
    if (row.status !== 'verified' && row.status !== 'superseded') throw notFound();
    if (who === 'owner' && !['EMITIDA', 'FINALIZADA'].includes(row.req_status)) throw notFound();
    if (who === 'owner' && row.status !== 'verified') throw notFound();
    const url = await storage.signDownload(row.object_key, row.original_name, row.content_type, cfg.PRESIGN_DOWNLOAD_TTL_SECONDS, mode);
    await audit(db, user, mode === 'inline' ? 'issued.view' : 'issued.download', 'request', row.request_id, { docId }, req.ip);
    return { url, expiresInSeconds: cfg.PRESIGN_DOWNLOAD_TTL_SECONDS, mode, filename: row.original_name, contentType: row.content_type };
  });
};
