import { useState } from 'react';
import { Link } from 'react-router-dom';
import RequestForm from '../components/RequestForm';
import { Alert, Button, Card } from '../ui';

export default function RequestWizard() {
  const [done, setDone] = useState<{ id: string; code: string } | null>(null);
  if (done)
    return (
      <Card className="mx-auto max-w-xl text-center">
        <div className="text-4xl">✅</div>
        <h1 className="mt-2 text-xl font-semibold">Solicitud registrada</h1>
        <p className="mt-1 text-sm text-slate-600">Su código de seguimiento es</p>
        <p className="my-3 select-all rounded-md bg-brand-50 py-3 font-mono text-2xl font-bold text-brand-900">{done.code}</p>
        <Alert kind="info">Recibirá un correo de confirmación. Los correos no incluyen sus documentos; consulte el estado y descargue resultados desde este portal.</Alert>
        <div className="mt-4 flex justify-center gap-2">
          <Link to={`/solicitud/${done.id}`}><Button>Ver seguimiento</Button></Link>
          <Link to="/"><Button variant="secondary">Mis trámites</Button></Link>
        </div>
      </Card>
    );
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold">Nueva solicitud</h1>
      <RequestForm onSent={(r) => setDone(r)} />
    </div>
  );
}
