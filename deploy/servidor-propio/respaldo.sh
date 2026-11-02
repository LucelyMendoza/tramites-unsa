#!/usr/bin/env bash
# Respaldo diario: base de datos + archivos. Programar con cron, p. ej.:
#   30 2 * * *  /opt/tramites/deploy/servidor-propio/respaldo.sh >> /var/log/tramites-respaldo.log 2>&1
# Copie luego RESPALDO_DIR a OTRO equipo o almacenamiento (regla 3-2-1). Probar la restauración cada trimestre.
set -euo pipefail
cd "$(dirname "$0")"
RESPALDO_DIR=${RESPALDO_DIR:-/var/backups/tramites}
DIAS=${DIAS_RETENCION:-30}
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "$RESPALDO_DIR"
docker compose exec -T db pg_dump -U tramites -d tramites -Fc > "$RESPALDO_DIR/db-$STAMP.dump"
docker run --rm -v tramites_archivos:/data:ro -v "$RESPALDO_DIR":/out alpine tar -czf "/out/archivos-$STAMP.tar.gz" -C /data .
# Cifrado opcional (recomendado si el respaldo sale del servidor): gpg --symmetric o age.
find "$RESPALDO_DIR" -type f -mtime +"$DIAS" -delete
echo "$(date -Is) respaldo OK: db-$STAMP.dump, archivos-$STAMP.tar.gz"
