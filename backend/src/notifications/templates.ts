import type { NotifyEvent } from '../domain/stateMachine.js';

export interface MailPayload {
  code?: string;
  name?: string;
  tramite?: string;
  reason?: string;
  targets?: { type: 'file' | 'field'; label: string }[];
  link: string;
  status?: string;
  hasIssuedDocument?: boolean;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function wrap(title: string, bodyHtml: string, link: string, cta: string) {
  return `<!doctype html><html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:auto">
<h2 style="color:#7f1d1d">${esc(title)}</h2>${bodyHtml}
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#7f1d1d;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(cta)}</a></p>
<p style="font-size:12px;color:#6b7280">Por seguridad no adjuntamos documentos personales a este correo. Ingrese al portal con su cuenta institucional.</p>
</body></html>`;
}

/**
 * Plantillas. Nunca incluyen DNI, CUI ni adjuntos: solo código, motivo de observación y enlace al portal autenticado.
 */
export function render(event: NotifyEvent, p: MailPayload): RenderedMail {
  const code = p.code ?? '';
  const hi = p.name ? `Estimado(a) ${p.name},` : 'Estimado(a) solicitante,';
  const tramite = p.tramite ? ` (${p.tramite})` : '';
  switch (event) {
    case 'ASIGNADA': {
      const hiStaff = p.name ? `Hola ${p.name},` : 'Hola,';
      const extra = p.reason ? ` ${p.reason}` : '';
      return {
        subject: `Nueva solicitud asignada: ${code}${tramite}`,
        text: `${hiStaff}\n\nSe le asignó la solicitud ${code}${tramite} para su atención.${extra}\n${p.link}\n`,
        html: wrap('Solicitud asignada', `<p>${esc(hiStaff)}</p><p>Se le asignó la solicitud <b>${esc(code)}</b>${esc(tramite)} para su atención.${esc(extra)}</p>`, p.link, 'Abrir en el panel'),
      };
    }
    case 'REEMITIDA':
      return {
        subject: `Documento corregido: ${code}`,
        text: `${hi}\n\nAtendimos su reporte y volvimos a emitir el documento de la solicitud ${code}${tramite}. Revíselo en el portal y confirme si ahora le llegó correctamente:\n${p.link}\n`,
        html: wrap('Documento corregido', `<p>${esc(hi)}</p><p>Atendimos su reporte y volvimos a emitir el documento de la solicitud <b>${esc(code)}</b>${esc(tramite)}.</p><p>Revíselo en el portal y <b>confirme si ahora le llegó correctamente</b>.</p>`, p.link, 'Revisar y confirmar'),
      };
    case 'RECEPCION_OBSERVADA': {
      const hiStaff = p.name ? `Hola ${p.name},` : 'Hola,';
      const msg = p.reason ? `\n\nMensaje del solicitante: "${p.reason}"` : '';
      return {
        subject: `El solicitante reporta un problema con el documento: ${code}`,
        text: `${hiStaff}\n\nEn la solicitud ${code}${tramite} el solicitante indicó que el documento NO le llegó correctamente.${msg}\n\nCorrija el documento y vuelva a enviarlo desde el panel:\n${p.link}\n`,
        html: wrap('Documento con observación del solicitante', `<p>${esc(hiStaff)}</p><p>En la solicitud <b>${esc(code)}</b>${esc(tramite)} el solicitante indicó que el documento <b>no le llegó correctamente</b>.</p>${p.reason ? `<blockquote style="border-left:3px solid #7f1d1d;margin:0;padding:6px 12px;color:#374151">${esc(p.reason)}</blockquote>` : ''}<p>Corrija el documento y vuelva a enviarlo desde el panel.</p>`, p.link, 'Abrir en el panel'),
      };
    }
    case 'REGISTRADA':
      return {
        subject: `Solicitud ${code} registrada`,
        text: `${hi}\n\nHemos registrado su solicitud ${code}${tramite}. Puede seguir su avance en el portal:\n${p.link}\n`,
        html: wrap('Solicitud registrada', `<p>${esc(hi)}</p><p>Hemos registrado su solicitud <b>${esc(code)}</b>${esc(tramite)}.</p>`, p.link, 'Ver mi solicitud'),
      };
    case 'SUBSANACION': {
      const targets = (p.targets ?? []).map((t) => `${t.type === 'file' ? 'Archivo' : 'Campo'}: ${t.label}`);
      return {
        subject: `Solicitud ${code}: requiere subsanación`,
        text:
          `${hi}\n\nSu solicitud ${code}${tramite} requiere correcciones.\n\nMotivo: ${p.reason ?? ''}\n` +
          (targets.length ? `\nDebe corregir:\n- ${targets.join('\n- ')}\n` : '') +
          `\nIngrese para subsanar (mantiene el mismo código ${code}):\n${p.link}\n`,
        html: wrap(
          'Su solicitud requiere subsanación',
          `<p>${esc(hi)}</p><p>Su solicitud <b>${esc(code)}</b>${esc(tramite)} fue observada.</p>
<p><b>Motivo:</b> ${esc(p.reason ?? '')}</p>${
            targets.length ? `<p><b>Debe corregir:</b></p><ul>${targets.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''
          }<p>Al subsanar, su solicitud conserva el mismo código.</p>`,
          p.link,
          'Subsanar solicitud',
        ),
      };
    }
    case 'REENVIADA':
      return {
        subject: `Solicitud ${code}: subsanación recibida`,
        text: `${hi}\n\nRecibimos la subsanación de su solicitud ${code}. Volverá a revisión.\n${p.link}\n`,
        html: wrap('Subsanación recibida', `<p>${esc(hi)}</p><p>Recibimos la subsanación de su solicitud <b>${esc(code)}</b>. Volverá a revisión.</p>`, p.link, 'Ver mi solicitud'),
      };
    case 'EN_TRAMITE':
      return {
        subject: `Solicitud ${code}: documentación aprobada, en trámite`,
        text: `${hi}\n\nSu documentación fue aprobada y su solicitud ${code} está en trámite.\n${p.link}\n`,
        html: wrap('Su solicitud está en trámite', `<p>${esc(hi)}</p><p>Su documentación fue aprobada; la solicitud <b>${esc(code)}</b> está en trámite.</p>`, p.link, 'Ver mi solicitud'),
      };
    case 'EMITIDA':
      return {
        subject: `Solicitud ${code}: documento emitido`,
        text: `${hi}\n\nSu documento fue emitido (solicitud ${code}). Ingrese al portal para consultarlo o descargarlo y confirme si le llegó correctamente (respuesta obligatoria para cerrar el trámite):\n${p.link}\n`,
        html: wrap('Documento emitido', `<p>${esc(hi)}</p><p>Su documento de la solicitud <b>${esc(code)}</b> fue emitido. Puede consultarlo y descargarlo desde el portal.</p><p>Al ingresar le preguntaremos <b>si el documento le llegó correctamente</b>; su respuesta es obligatoria para cerrar el trámite.</p>`, p.link, 'Ver y confirmar'),
      };
    case 'FINALIZADA':
      return {
        subject: `Solicitud ${code}: trámite finalizado`,
        text:
          `${hi}\n\nSu trámite ${code}${tramite} ha finalizado.\n` +
          (p.hasIssuedDocument
            ? `Para consultar o descargar el documento final, ingrese con su cuenta institucional a:\n${p.link}\n(sección "Documento emitido" del detalle de la solicitud).\n`
            : `Consulte el detalle en:\n${p.link}\n`),
        html: wrap(
          'Trámite finalizado',
          `<p>${esc(hi)}</p><p>Su trámite <b>${esc(code)}</b>${esc(tramite)} ha finalizado.</p>${
            p.hasIssuedDocument
              ? '<p>Para consultar o descargar el documento final, ingrese con su cuenta institucional y abra la sección <b>Documento emitido</b> del detalle de la solicitud.</p>'
              : ''
          }`,
          p.link,
          'Abrir mi solicitud',
        ),
      };
  }
}
