export const STATUSES = [
  'BORRADOR',
  'ENVIADA',
  'EN_REVISION',
  'REQUIERE_SUBSANACION',
  'REENVIADA',
  'EN_TRAMITE',
  'EMITIDA',
  'FINALIZADA',
] as const;
export type Status = (typeof STATUSES)[number];

export type Actor = 'applicant' | 'review' | 'issue';

interface Transition {
  from: Status;
  to: Status;
  actor: Actor;
  reasonRequired?: boolean;
  /** Evento de notificación al solicitante (si corresponde). */
  notify?: NotifyEvent;
}

export type NotifyEvent = 'REGISTRADA' | 'SUBSANACION' | 'REENVIADA' | 'EN_TRAMITE' | 'EMITIDA' | 'FINALIZADA' | 'ASIGNADA' | 'REEMITIDA' | 'RECEPCION_OBSERVADA';

// Flujo único controlado desde el backend.
export const TRANSITIONS: Transition[] = [
  { from: 'BORRADOR', to: 'ENVIADA', actor: 'applicant', notify: 'REGISTRADA' },
  { from: 'ENVIADA', to: 'EN_REVISION', actor: 'review' },
  { from: 'REENVIADA', to: 'EN_REVISION', actor: 'review' },
  { from: 'EN_REVISION', to: 'REQUIERE_SUBSANACION', actor: 'review', reasonRequired: true, notify: 'SUBSANACION' },
  { from: 'EN_TRAMITE', to: 'REQUIERE_SUBSANACION', actor: 'review', reasonRequired: true, notify: 'SUBSANACION' },
  { from: 'REQUIERE_SUBSANACION', to: 'REENVIADA', actor: 'applicant', notify: 'REENVIADA' },
  { from: 'EN_REVISION', to: 'EN_TRAMITE', actor: 'review', notify: 'EN_TRAMITE' },
  { from: 'EN_TRAMITE', to: 'EMITIDA', actor: 'issue', notify: 'EMITIDA' },
  { from: 'EMITIDA', to: 'FINALIZADA', actor: 'issue', notify: 'FINALIZADA' },
  // El solicitante confirma que recibió bien el documento (encuesta obligatoria) → se cierra el trámite.
  { from: 'EMITIDA', to: 'FINALIZADA', actor: 'applicant', notify: 'FINALIZADA' },
];

export function findTransition(from: Status, to: Status, actor: Actor): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to && t.actor === actor);
}

export function allowedNext(from: Status, actor: Actor): Status[] {
  return TRANSITIONS.filter((t) => t.from === from && t.actor === actor).map((t) => t.to);
}

/** Estados en los que el solicitante puede modificar datos/archivos del expediente. */
export const APPLICANT_EDITABLE: Status[] = ['BORRADOR', 'REQUIERE_SUBSANACION'];
