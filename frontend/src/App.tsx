import { Link, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Alert, BrandMark, Button, Spinner } from './ui';
import Login from './pages/Login';
import Home from './pages/Home';
import RequestWizard from './pages/RequestWizard';
import RequestDetail from './pages/RequestDetail';
import AdminDashboard from './pages/admin/Dashboard';
import AdminDetail from './pages/admin/Detail';
import AdminCatalog from './pages/admin/Catalog';
import AdminSystem from './pages/admin/System';
import AdminAssignments from './pages/admin/Assignments';
import AdminTramites from './pages/admin/Tramites';
import AdminStats from './pages/admin/Stats';
import AdminActivity from './pages/admin/Activity';
import AdminLayout from './components/AdminLayout';
import { ReceiptGate } from './components/ReceiptSurvey';

const ROLE_LABEL = { superadmin: 'Superadministrador', reviewer: 'Revisor', issuer: 'Emisor' } as const;
const initials = (n?: string | null, e?: string) =>
  ((n || e || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('') || '?').toUpperCase();

function Shell({ admin }: { admin: boolean }) {
  const { me, config, logout } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) =>
    `shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`;
  return (
    <div className="min-h-screen bg-slate-50">
      {config?.testMode && (
        <div className="bg-amber-50 px-4 py-1.5 text-center text-xs font-medium text-amber-900 ring-1 ring-amber-200">
          Entorno de pruebas · cuentas y datos ficticios · no ingrese datos personales reales
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link to={admin ? '/admin' : '/'} className="flex min-w-0 items-center gap-3">
            <BrandMark />
            <span className="min-w-0 leading-tight">
              <span className="block text-sm font-semibold text-slate-900">Trámites UNSA</span>
              <span className="hidden truncate text-xs text-slate-500 sm:block">{admin ? 'Panel administrativo' : 'Dirección de Servicios Académicos'}</span>
            </span>
          </Link>
          {/* En móvil la navegación baja a una segunda fila a lo ancho */}
          <nav className="order-last -mx-1 flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto sm:flex-1">
            {admin ? (
              <>
                <NavLink to="/admin" end className={link}>Solicitudes</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/" end className={link}>Mis trámites</NavLink>
                <NavLink to="/nuevo" className={link}>Nueva solicitud</NavLink>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <span className="hidden text-right leading-tight sm:block">
              <span className="block max-w-[14rem] truncate text-sm font-medium text-slate-900">{me?.name || me?.email}</span>
              <span className="block text-xs text-slate-500">
                {me?.staff ? ROLE_LABEL[me.staff.role] : me?.applicantType === 'egresado' ? 'Egresado' : 'Estudiante'}
              </span>
            </span>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800" title={me?.name || me?.email}>{initials(me?.name, me?.email)}</span>
            <Button variant="secondary" onClick={() => logout()} className="!px-3 !py-1.5 !text-xs">Salir</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
      {!admin && <ReceiptGate />}
      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-slate-400 sm:px-6">
        UNSA · Dirección de Servicios Académicos · Sistema de Gestión de Trámites
      </footer>
    </div>
  );
}

export default function App() {
  const { me, loading, error } = useAuth();
  if (loading) return <Spinner />;
  if (!me) return <Login />;
  const isStaff = !!me.staff;
  return (
    <>
      {error && <div className="mx-auto max-w-7xl px-4 pt-4"><Alert kind="error">{error}</Alert></div>}
      <Routes>
        {/* Portal del solicitante */}
        <Route element={isStaff ? <Navigate to="/admin" replace /> : <Shell admin={false} />}>
          <Route index element={<Home />} />
          <Route path="nuevo" element={<RequestWizard />} />
          <Route path="solicitud/:id" element={<RequestDetail />} />
        </Route>
        {/* Panel administrativo independiente (el backend vuelve a validar cada acción) */}
        <Route path="admin" element={isStaff ? <AdminLayout /> : <Navigate to="/" replace />}>
          <Route index element={<AdminDashboard />} />
          <Route path="solicitud/:id" element={<AdminDetail />} />
          <Route path="catalogo" element={<AdminCatalog />} />
          <Route path="responsables" element={<AdminAssignments />} />
          <Route path="tramites" element={<AdminTramites />} />
          <Route path="estadisticas" element={<AdminStats />} />
          <Route path="actividad" element={<AdminActivity />} />
          <Route path="sistema" element={<AdminSystem />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
