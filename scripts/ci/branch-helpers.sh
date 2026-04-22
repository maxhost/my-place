#!/usr/bin/env bash
# Supabase branching helpers para CI E2E.
#
# Usa la Management API (https://api.supabase.com/v1/) con un Personal Access
# Token (Supabase Dashboard → Account → Access Tokens). Requiere:
#   SUPABASE_ACCESS_TOKEN  — token con scope projects:write,branches:write
#   SUPABASE_PROJECT_REF   — ref del proyecto (ej: pdifweaajellxzdpbaht)
#
# Funciones exportadas:
#   create_branch <name>              → crea branch y escribe id a stdout
#   poll_until_active <branch_id>     → espera status=ACTIVE (timeout ~4min)
#   fetch_branch_env <branch_id>      → emite líneas KEY=value para GITHUB_ENV
#   delete_branch <branch_id>         → borra branch (safe si no existe)
#
# Diseñado para invocarse desde `.github/workflows/ci.yml`. Las funciones
# fallan rápido (`set -euo pipefail`) y loguean a stderr; solo el payload
# útil va a stdout para que GH Actions pueda capturarlo.

set -euo pipefail

SUPABASE_API_BASE="${SUPABASE_API_BASE:-https://api.supabase.com/v1}"

_require_env() {
  local var="$1"
  if [[ -z "${!var:-}" ]]; then
    echo "[branch-helpers] falta env var: $var" >&2
    exit 1
  fi
}

_require_env SUPABASE_ACCESS_TOKEN
_require_env SUPABASE_PROJECT_REF

_auth_header() {
  echo "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}"
}

create_branch() {
  local name="$1"
  echo "[branch-helpers] creando branch '$name' en proyecto $SUPABASE_PROJECT_REF…" >&2
  local response
  response=$(
    curl -fsS -X POST \
      -H "$(_auth_header)" \
      -H "Content-Type: application/json" \
      -d "{\"branch_name\": \"$name\"}" \
      "${SUPABASE_API_BASE}/projects/${SUPABASE_PROJECT_REF}/branches"
  )
  local branch_id
  branch_id=$(echo "$response" | jq -r '.id // empty')
  if [[ -z "$branch_id" ]]; then
    echo "[branch-helpers] create falló: $response" >&2
    exit 1
  fi
  echo "$branch_id"
}

poll_until_active() {
  local branch_id="$1"
  local max_attempts=40
  local delay=6
  for ((i = 1; i <= max_attempts; i++)); do
    local status
    status=$(
      curl -fsS -H "$(_auth_header)" \
        "${SUPABASE_API_BASE}/branches/${branch_id}" | jq -r '.status // "UNKNOWN"'
    )
    echo "[branch-helpers] attempt $i/$max_attempts: status=$status" >&2
    if [[ "$status" == "ACTIVE_HEALTHY" || "$status" == "ACTIVE" ]]; then
      return 0
    fi
    if [[ "$status" == "FAILED" || "$status" == "ERROR" ]]; then
      echo "[branch-helpers] branch en estado terminal $status — abort" >&2
      exit 1
    fi
    sleep "$delay"
  done
  echo "[branch-helpers] timeout esperando ACTIVE tras $((max_attempts * delay))s" >&2
  exit 1
}

# Emite líneas `KEY=value` que el caller puede appendear a $GITHUB_ENV.
# Campos derivados: DATABASE_URL (pooler transaction), DIRECT_URL (session),
# NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
fetch_branch_env() {
  local branch_id="$1"
  local body
  body=$(curl -fsS -H "$(_auth_header)" "${SUPABASE_API_BASE}/branches/${branch_id}")

  local ref db_host db_user db_pass db_name
  ref=$(echo "$body" | jq -r '.project_ref // .ref // empty')
  db_host=$(echo "$body" | jq -r '.database.db_host // empty')
  db_user=$(echo "$body" | jq -r '.database.db_user // "postgres"')
  db_pass=$(echo "$body" | jq -r '.database.db_pass // empty')
  db_name=$(echo "$body" | jq -r '.database.db_name // "postgres"')

  if [[ -z "$ref" || -z "$db_host" || -z "$db_pass" ]]; then
    echo "[branch-helpers] respuesta branch incompleta: $body" >&2
    exit 1
  fi

  # Pooler transaction (6543, pgbouncer=true) para runtime;
  # puerto 5432 session para migraciones y RLS harness.
  echo "DATABASE_URL=postgresql://postgres.${ref}:${db_pass}@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
  echo "DIRECT_URL=postgresql://postgres.${ref}:${db_pass}@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
  echo "NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co"

  # Claves públicas + service role: fetch separado porque no vienen en el branch body.
  local keys_body
  keys_body=$(
    curl -fsS -H "$(_auth_header)" \
      "${SUPABASE_API_BASE}/projects/${ref}/api-keys?reveal=true"
  )
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$(echo "$keys_body" | jq -r '.[] | select(.name=="anon") | .api_key')"
  echo "SUPABASE_SERVICE_ROLE_KEY=$(echo "$keys_body" | jq -r '.[] | select(.name=="service_role") | .api_key')"
}

delete_branch() {
  local branch_id="$1"
  echo "[branch-helpers] borrando branch $branch_id…" >&2
  curl -fsS -X DELETE \
    -H "$(_auth_header)" \
    "${SUPABASE_API_BASE}/branches/${branch_id}" >/dev/null || {
    echo "[branch-helpers] delete falló (branch puede no existir ya)" >&2
    return 0
  }
  echo "[branch-helpers] delete OK" >&2
}

# Ejecución inline desde el workflow: `bash scripts/ci/branch-helpers.sh <fn> <args>`
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  fn="${1:-}"
  shift || true
  case "$fn" in
    create_branch | poll_until_active | fetch_branch_env | delete_branch)
      "$fn" "$@"
      ;;
    *)
      echo "Uso: $0 {create_branch|poll_until_active|fetch_branch_env|delete_branch} <args>" >&2
      exit 1
      ;;
  esac
fi
