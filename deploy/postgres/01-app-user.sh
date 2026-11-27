#!/bin/sh
set -eu
DB_APP_PASSWORD=$(cat /run/secrets/postgres_password)
export DB_APP_PASSWORD
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv app_password DB_APP_PASSWORD
CREATE ROLE mkdocsweb LOGIN PASSWORD :'app_password';
CREATE DATABASE mkdocsweb OWNER mkdocsweb;
SQL
unset DB_APP_PASSWORD
