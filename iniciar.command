#!/bin/bash
# Inicia el sistema de trámites en modo desarrollo (backend :4000 + frontend :5173).
# Doble clic en Finder, o desde Terminal: ./iniciar.command   ·   Ctrl+C para detener todo.
set -e
cd "$(dirname "$0")"
trap 'echo; echo "Deteniendo servidores…"; kill 0 2>/dev/null' EXIT

echo "== Trámites UNSA · entorno de desarrollo =="
command -v node >/dev/null || { echo "Falta Node.js (>= 20). Instálelo desde https://nodejs.org"; read -r -p "Enter para salir"; exit 1; }

# 1. Liberar puertos si quedó una ejecución anterior
for p in 4000 5173; do
  pids=$(lsof -ti tcp:$p 2>/dev/null || true)
  if [ -n "$pids" ]; then echo "Cerrando proceso anterior en el puerto $p"; kill $pids 2>/dev/null || true; fi
done
sleep 1

# 2. Dependencias (solo la primera vez)
[ -d backend/node_modules ]  || (echo "Instalando dependencias del backend…";  cd backend  && npm install)
[ -d frontend/node_modules ] || (echo "Instalando dependencias del frontend…"; cd frontend && npm install)

# 3. Datos de demostración (solo si la base está vacía)
(cd backend && npm run --silent demo)

# 4. Servidores
(cd backend && npm run dev) &
(cd frontend && npm run dev -- --port 5173 --strictPort) &

# 5. Abrir el navegador cuando el API responda
for _ in $(seq 1 40); do
  curl -s -o /dev/null http://localhost:4000/api/health && break
  sleep 0.5
done
sleep 2
open http://localhost:5173 2>/dev/null || true
echo
echo "Listo: http://localhost:5173  (API: http://localhost:4000)"
echo "Ctrl+C o cerrar esta ventana para detener."
wait
