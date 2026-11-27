#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
command -v openssl >/dev/null || { echo 'openssl is required' >&2; exit 1; }
umask 077
mkdir -p .secrets
chmod 700 .secrets
for name in master_key postgres_password postgres_admin_password admin_password; do
  file=".secrets/$name"
  if [ -e "$file" ]; then
    [ -s "$file" ] || { echo "Refusing to overwrite empty $file" >&2; exit 1; }
  else
    temporary=$(mktemp .secrets/.new.XXXXXX)
    openssl rand -base64 32 > "$temporary"
    mv "$temporary" "$file"
  fi
  # Local Compose file secrets retain source permissions. The containing directory
  # is owner-only; readable files let the non-root container read its own mounts.
  chmod 644 "$file"
done
if [ ! -f .env ]; then cp .env.example .env; chmod 600 .env; fi
printf '%s\n' 'Compose secrets prepared. Existing keys and passwords were preserved.' 'Start: docker compose up -d --build' 'Admin password: cat .secrets/admin_password'
