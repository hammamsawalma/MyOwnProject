#!/usr/bin/env bash
# Local PostgreSQL 16 for development and tests, without Docker.
# Data lives in web/.pgdata (gitignored); server listens on 127.0.0.1:54329.
#
#   bash scripts/dev-db.sh start | stop | status | reset | psql [db]
#
# Creates the databases studio_dev and studio_test (user "postgres", trust auth,
# localhost only; never use this setup in production).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
PGDATA_DIR="${PGDATA_DIR:-$WEB_DIR/.pgdata}"
PGPORT="${PGPORT:-54329}"
LOG_FILE="$PGDATA_DIR/server.log"
DATABASES=(studio_dev studio_test)

find_pg_bin() {
  if [[ -n "${PG_BIN:-}" ]]; then echo "$PG_BIN"; return; fi
  for dir in /usr/lib/postgresql/16/bin /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin; do
    [[ -x "$dir/pg_ctl" ]] && { echo "$dir"; return; }
  done
  dirname "$(command -v pg_ctl 2>/dev/null || echo /nonexistent/pg_ctl)"
}
PG_BIN="$(find_pg_bin)"
[[ -x "$PG_BIN/pg_ctl" ]] || { echo "pg_ctl not found. Install PostgreSQL 16 or set PG_BIN." >&2; exit 1; }

# PostgreSQL refuses to run as root; in containers run it as the "postgres" user.
as_pg() {
  if [[ "$(id -u)" == "0" ]]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

ensure_owner() {
  if [[ "$(id -u)" == "0" ]]; then chown -R postgres:postgres "$PGDATA_DIR"; fi
}

is_running() {
  [[ -f "$PGDATA_DIR/PG_VERSION" ]] && as_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" status >/dev/null 2>&1
}

psql_cmd() {
  "$PG_BIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 "$@"
}

init_cluster() {
  if [[ ! -f "$PGDATA_DIR/PG_VERSION" ]]; then
    mkdir -p "$PGDATA_DIR"
    ensure_owner
    as_pg "$PG_BIN/initdb" -D "$PGDATA_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
    echo "Initialized cluster in $PGDATA_DIR"
  fi
}

start() {
  init_cluster
  if is_running; then
    echo "PostgreSQL already running on port $PGPORT"
  else
    ensure_owner
    as_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" -l "$LOG_FILE" -w \
      -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start >/dev/null
    echo "PostgreSQL started on 127.0.0.1:$PGPORT"
  fi
  for db in "${DATABASES[@]}"; do
    if ! psql_cmd -d postgres -tAc "select 1 from pg_database where datname = '$db'" | grep -q 1; then
      psql_cmd -d postgres -qc "create database $db" && echo "Created database $db"
    fi
  done
}

stop() {
  if is_running; then
    as_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" -m fast -w stop >/dev/null
    echo "PostgreSQL stopped"
  else
    echo "PostgreSQL is not running"
  fi
}

status() {
  if is_running; then echo "running on 127.0.0.1:$PGPORT ($PGDATA_DIR)"; else echo "stopped"; fi
}

reset() {
  stop
  rm -rf "$PGDATA_DIR"
  start
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  reset) reset ;;
  psql) shift; psql_cmd -d "${1:-studio_dev}" ;;
  *) echo "usage: $0 start|stop|status|reset|psql [db]" >&2; exit 2 ;;
esac
