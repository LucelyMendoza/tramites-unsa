export type StaffRole = 'superadmin' | 'reviewer' | 'issuer';
export type Permission =
  | 'request:view'
  | 'request:review'
  | 'request:assign'
  | 'request:issue'
  | 'request:finalize'
  | 'declaration:verify'
  | 'report:export'
  | 'catalog:manage'
  | 'staff:view'
  | 'audit:view'
  | 'assignment:manage';

const MATRIX: Record<StaffRole, Permission[]> = {
  superadmin: [
    'request:view',
    'request:review',
    'request:assign',
    'request:issue',
    'request:finalize',
    'declaration:verify',
    'report:export',
    'catalog:manage',
    'staff:view',
    'audit:view',
    'assignment:manage',
  ],
  // El revisor atiende el trámite de punta a punta: revisa, emite (carga/reemplaza el PDF), reenvía y finaliza.
  reviewer: ['request:view', 'request:review', 'request:assign', 'request:issue', 'request:finalize', 'declaration:verify', 'report:export'],
  issuer: ['request:view', 'request:issue', 'request:finalize'],
};

export function can(role: StaffRole | undefined, perm: Permission): boolean {
  return !!role && MATRIX[role].includes(perm);
}

export function permissionsOf(role: StaffRole | undefined): Permission[] {
  return role ? MATRIX[role] : [];
}

/** scope null/undefined => todas las facultades; lista => solo esas (lista vacía = ninguna). */
export function inScope(scope: string[] | null | undefined, facultyId: string): boolean {
  if (scope == null) return true;
  return scope.includes(facultyId);
}
