<#
.SYNOPSIS
  Run the database-backed tests without Docker.

.DESCRIPTION
  `scripts/local-db.sh` (Docker + `alembic upgrade head`) is the real path and stays the source of truth. This
  is the fallback for a Windows machine where Docker cannot start: Docker Desktop needs WSL2, WSL needs the
  Virtual Machine Platform feature, and enabling that needs a reboot.

  This downloads the official PostgreSQL binaries (a zip, no installer, no admin rights), runs a throwaway
  cluster on a non-default port, builds the schema from the SQLAlchemy models, and runs pytest against it.

  Two differences from the Docker path, both deliberate and stated in scripts/create_test_schema.py:
    * The schema comes from the models rather than the migration chain, so this does not catch migration drift.
      `alembic check` does that, and it needs its own database.
    * pgvector is not part of a stock PostgreSQL distribution and cannot be installed without a compiler, so
      the `embeddings` table is skipped. No database-backed test touches it; semantic search is covered in CI
      against a real pgvector instance.

.EXAMPLE
  pwsh scripts/local-db-native.ps1
  pwsh scripts/local-db-native.ps1 -Stop      # shut the cluster down
#>
[CmdletBinding()]
param(
  [int]$Port = 55432,
  [string]$Root = (Join-Path $env:TEMP "katha-pg"),
  [switch]$Stop
)

$ErrorActionPreference = "Stop"
$PgVersion = "16.4-1"
$Url = "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-windows-x64-binaries.zip"

$repo = Split-Path -Parent $PSScriptRoot
$zip = Join-Path $Root "postgresql.zip"
$bin = Join-Path $Root "pgsql\bin"
$data = Join-Path $Root "data"
$log = Join-Path $Root "postgres.log"
$dbUrl = "postgresql+asyncpg://katha:katha@127.0.0.1:$Port/katha_test"

function Say($m) { Write-Host "==> $m" -ForegroundColor Magenta }

if ($Stop) {
  if (Test-Path (Join-Path $bin "pg_ctl.exe")) {
    & (Join-Path $bin "pg_ctl.exe") -D $data -m fast stop
    Say "stopped"
  } else {
    Say "nothing to stop"
  }
  return
}

New-Item -ItemType Directory -Force -Path $Root | Out-Null

if (-not (Test-Path (Join-Path $bin "postgres.exe"))) {
  if (-not (Test-Path $zip)) {
    Say "Downloading PostgreSQL $PgVersion (about 320 MB, once)"
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing -TimeoutSec 900
  }
  Say "Extracting"
  Expand-Archive -Path $zip -DestinationPath $Root -Force
}

# `pg_ctl status` exits non-zero when the server is down, which is not an error here.
$running = $false
try {
  & (Join-Path $bin "pg_ctl.exe") -D $data status *> $null
  $running = ($LASTEXITCODE -eq 0)
} catch { $running = $false }

if (-not $running) {
  if (-not (Test-Path (Join-Path $data "PG_VERSION"))) {
    Say "Initialising the cluster"
    $pwFile = Join-Path $Root "pw.txt"
    Set-Content -Path $pwFile -Value "katha" -NoNewline -Encoding ascii
    & (Join-Path $bin "initdb.exe") -D $data -U katha --pwfile=$pwFile -E UTF8 --locale=C | Out-Null
    Remove-Item $pwFile -Force
  }
  Say "Starting PostgreSQL on port $Port"
  & (Join-Path $bin "pg_ctl.exe") -D $data -o "-p $Port -c listen_addresses=127.0.0.1" -l $log -w start | Out-Null
}

$env:PGPASSWORD = "katha"
$psql = Join-Path $bin "psql.exe"
$exists = & $psql -h 127.0.0.1 -p $Port -U katha -d postgres -tAc "select 1 from pg_database where datname='katha_test'"
if (-not $exists) {
  Say "Creating katha_test"
  & $psql -h 127.0.0.1 -p $Port -U katha -d postgres -c "CREATE DATABASE katha_test" | Out-Null
}

Push-Location (Join-Path $repo "services\api")
try {
  $env:KATHA_TEST_DATABASE_URL = $dbUrl
  Say "Building the schema from the models"
  python -m uv run python scripts/create_test_schema.py

  Say "Running the test suite, including the database-backed tests"
  python -m uv run pytest -q
} finally {
  Pop-Location
}

Say "Done. The cluster is still running on port $Port."
Write-Host "  KATHA_TEST_DATABASE_URL=$dbUrl"
Write-Host "  stop it with: pwsh scripts/local-db-native.ps1 -Stop"
