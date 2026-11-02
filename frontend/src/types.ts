export type Status = 'BORRADOR' | 'ENVIADA' | 'EN_REVISION' | 'REQUIERE_SUBSANACION' | 'REENVIADA' | 'EN_TRAMITE' | 'EMITIDA' | 'FINALIZADA';
export const STATUS_LABEL: Record<Status, string> = {
  BORRADOR: 'Borrador',
  ENVIADA: 'Enviada',
  EN_REVISION: 'En revisión',
  REQUIERE_SUBSANACION: 'Requiere subsanación',
  REENVIADA: 'Reenviada',
  EN_TRAMITE: 'En trámite',
  EMITIDA: 'Emitida',
  FINALIZADA: 'Finalizada',
};
export const STATUS_STYLE: Record<Status, string> = {
  BORRADOR: 'bg-slate-100 text-slate-700',
  ENVIADA: 'bg-sky-100 text-sky-800',
  EN_REVISION: 'bg-indigo-100 text-indigo-800',
  REQUIERE_SUBSANACION: 'bg-amber-100 text-amber-900',
  REENVIADA: 'bg-violet-100 text-violet-800',
  EN_TRAMITE: 'bg-blue-100 text-blue-800',
  EMITIDA: 'bg-emerald-100 text-emerald-800',
  FINALIZADA: 'bg-green-200 text-green-900',
};

export interface Me {
  id: string;
  email: string;
  name: string | null;
  applicantType: 'estudiante' | 'egresado' | null;
  staff: { role: 'superadmin' | 'reviewer' | 'issuer'; scope: string[] | null; permissions: string[] } | null;
}
export interface PublicConfig {
  authMode: 'dev' | 'firebase' | 'hybrid';
  googleEnabled: boolean;
  testAccounts: boolean;
  allowedDomains: string[];
  maxFileMb: number;
  environment: string;
  testMode: boolean;
}
export type FieldDef =
  | { key: string; type: 'multi-year'; label: string; required: boolean; yearsBack: number; maxSelect: number }
  | { key: string; type: 'text'; label: string; required: boolean; maxLength: number }
  | { key: string; type: 'select'; label: string; required: boolean; options: string[] }
  | { key: string; type: 'multi-select'; label: string; required: boolean; options: string[]; maxSelect: number }
  | { key: string; type: 'receipt'; label: string; required: boolean; unique: boolean };
export interface DocDef { slot: string; label: string; kinds: ('pdf' | 'jpg' | 'png')[]; maxMb?: number }
export interface TramiteType {
  id: string; code: string; name: string; group: string; description: string; version: number;
  requiredDocs: DocDef[]; fields: FieldDef[]; requiresDeclaration: boolean; declarationText?: string;
}
export interface Catalog {
  faculties: { id: string; code: string; name: string }[];
  schools: { id: string; facultyId: string; code: string; name: string }[];
  programs: { id: string; schoolId: string; name: string }[];
  tramiteTypes: TramiteType[];
}
export interface FileRow { id: string; slot: string; version: number; originalName: string; sizeBytes: number; contentType: string; status: string; isCurrent: boolean; uploadedAt: string }
export interface Detail {
  id: string; code: string | null; status: Status; applicantType: 'estudiante' | 'egresado';
  apellidosNombres: string; dni: string; cui: string;
  facultyId: string; facultyName: string; schoolId: string; schoolName: string; programId: string | null; programName: string | null;
  tramiteTypeId: string; tramiteName: string; typeData: Record<string, unknown>;
  config: { requiredDocs: DocDef[]; fields: FieldDef[]; requiresDeclaration: boolean; finalizeRequires: string[] };
  resubmitCount: number; submittedAt: string | null; finalizedAt: string | null; createdAt: string; updatedAt: string;
  ownerEmail?: string; assignedTo?: string | null; assignedEmail?: string | null; directoryCheck?: { status: string; message?: string } | null;
  files: FileRow[];
  observations: { id: string; kind: 'nota' | 'subsanacion'; reason: string; targets: { type: string; key: string }[]; targetLabels: { type: string; label: string }[]; resolvedAt: string | null; createdAt: string; author: string }[];
  history: { id: string; from: Status | null; to: Status; reason: string | null; at: string; actor: string }[];
  declaration: { textVersion: string; text: string; acceptedAt: string; verificationStatus: 'pendiente' | 'verificada' | 'rechazada'; verificationNote?: string; verifiedAt: string | null } | null;
  issuedDocuments: { id: string; version: number; originalName: string; sizeBytes: number; status: string; issuedAt: string }[];
  receipt: {
    currentDocId: string | null; currentVersion: number | null; pending: boolean; answer: 'si' | 'no' | null; canResend: boolean;
    openComplaint: { message: string; answeredAt: string; version: number } | null;
    history: { version: number; answer: 'si' | 'no'; message: string | null; answeredAt: string; resolvedAt: string | null }[];
  };
  editable?: { all: boolean; files: string[]; fields: string[] } | null;
  can?: { review: boolean; assign: boolean; issue: boolean; finalize: boolean; verifyDeclaration: boolean };
}
