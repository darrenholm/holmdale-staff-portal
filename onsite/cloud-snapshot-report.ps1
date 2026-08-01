<#
  Cloud snapshot + side-by-side sales report  (Railway -> local rodeo_db)

  1. Dumps the cloud (Railway) production database READ-ONLY. The dump
     connection is forced read-only (default_transaction_read_only=on), so
     this step cannot write anything to the cloud.
  2. Restores that dump into a schema named `cloud_snapshot` INSIDE the local
     rodeo_db. Existing local tables (schema `public`) are never touched:
     the dump is first restored into a throwaway scratch database, the schema
     is renamed there, and only then is the `cloud_snapshot` schema loaded
     into rodeo_db. The only thing dropped/created in rodeo_db is the
     `cloud_snapshot` schema itself (replaced on every run).
  3. Runs today's sales report (cloud-snapshot-report.sql) against local
     `public` and `cloud_snapshot` side by side — food / alcohol / ice cream
     counts + totals — and flags wristband UIDs with transactions in BOTH.

  Uses the same connection setup as ticket-sync.ps1 (already done on the NUC):
    setx PROD_URL   "postgresql://postgres:PASSWORD@mainline.proxy.rlwy.net:31899/railway"
    setx PGPASSWORD "<LOCAL postgres password>"

  RUN:
    cd C:\rodeo\holmdale-staff-portal\onsite
    powershell -ExecutionPolicy Bypass -File .\cloud-snapshot-report.ps1

  Options:
    -ReportDate 2026-08-01   report a different day (default: today)
    -SkipSnapshot            re-run the report only, against the existing
                             cloud_snapshot schema from a previous run
#>
param(
  [string]$ReportDate = (Get-Date -Format 'yyyy-MM-dd'),
  [switch]$SkipSnapshot
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$PGBIN     = 'C:\Program Files\PostgreSQL\17\bin'
$PSQL      = Join-Path $PGBIN 'psql.exe'
$PGDUMP    = Join-Path $PGBIN 'pg_dump.exe'
$PGRESTORE = Join-Path $PGBIN 'pg_restore.exe'
$LOCALDB   = 'rodeo_db'
$SCRATCHDB = 'cloud_snapshot_scratch'   # throwaway; dropped at the end
$CLOUD     = $env:PROD_URL
$REPORT    = Join-Path $here 'cloud-snapshot-report.sql'

# Event timezone, and the timezone the cloud server writes naive TIMESTAMP
# columns in (Railway Postgres runs in UTC). Used to line up "today".
$EVENT_TZ       = 'America/Toronto'
$CLOUD_NAIVE_TZ = 'UTC'

if (-not (Test-Path $PSQL))    { Write-Error "psql not found at $PSQL"; exit 1 }
if (-not (Test-Path $REPORT))  { Write-Error "Report SQL not found at $REPORT"; exit 1 }
if (-not $env:PGPASSWORD)      { Write-Error 'PGPASSWORD is not set (LOCAL postgres password). See header.'; exit 1 }

if (-not $SkipSnapshot) {
  if (-not $CLOUD) { Write-Error 'PROD_URL is not set (cloud connection string). See header.'; exit 1 }
  if ($CLOUD -match 'localhost|127\.0\.0\.1') { Write-Error 'PROD_URL points at localhost — refusing (expected the Railway URL).'; exit 1 }

  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $cloudDump  = Join-Path $env:TEMP "cloud_snapshot_$stamp.dump"
  $schemaDump = Join-Path $env:TEMP "cloud_snapshot_schema_$stamp.dump"

  Write-Host '1/5 Dumping cloud database (read-only)...' -ForegroundColor Cyan
  $oldPgOptions = $env:PGOPTIONS
  $env:PGOPTIONS = '-c default_transaction_read_only=on'
  try {
    & $PGDUMP --no-owner --no-privileges -Fc -f $cloudDump "$CLOUD"
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump of cloud failed' }
  } finally {
    $env:PGOPTIONS = $oldPgOptions
  }
  Write-Host ('    dump: {0:N1} MB' -f ((Get-Item $cloudDump).Length / 1MB))

  Write-Host "2/5 Restoring into scratch database '$SCRATCHDB'..." -ForegroundColor Cyan
  & $PSQL -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $SCRATCHDB WITH (FORCE)"
  if ($LASTEXITCODE -ne 0) { throw 'dropping old scratch db failed' }
  & $PSQL -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $SCRATCHDB"
  if ($LASTEXITCODE -ne 0) { throw 'creating scratch db failed' }
  # pg_restore exits 1 on harmless ownership warnings; verify with a query below.
  & $PGRESTORE --no-owner --no-privileges -U postgres -d $SCRATCHDB $cloudDump
  & $PSQL -U postgres -d $SCRATCHDB -v ON_ERROR_STOP=1 -tAc 'SELECT COUNT(*) FROM wristbands' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'scratch restore verification failed (wristbands table missing)' }

  Write-Host '3/5 Renaming schema public -> cloud_snapshot in scratch...' -ForegroundColor Cyan
  & $PSQL -U postgres -d $SCRATCHDB -v ON_ERROR_STOP=1 -c 'ALTER SCHEMA public RENAME TO cloud_snapshot'
  if ($LASTEXITCODE -ne 0) { throw 'schema rename failed' }
  & $PGDUMP --no-owner --no-privileges -Fc --schema=cloud_snapshot -U postgres -f $schemaDump $SCRATCHDB
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump of renamed schema failed' }

  Write-Host "4/5 Loading cloud_snapshot schema into $LOCALDB (public untouched)..." -ForegroundColor Cyan
  & $PSQL -U postgres -d $LOCALDB -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS cloud_snapshot CASCADE'
  if ($LASTEXITCODE -ne 0) { throw 'dropping previous cloud_snapshot schema failed' }
  & $PGRESTORE --no-owner --no-privileges -U postgres -d $LOCALDB $schemaDump
  & $PSQL -U postgres -d $LOCALDB -v ON_ERROR_STOP=1 -tAc 'SELECT COUNT(*) FROM cloud_snapshot.wristbands' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'cloud_snapshot verification failed (cloud_snapshot.wristbands missing)' }

  Write-Host '    cleaning up scratch db and temp dumps...'
  & $PSQL -U postgres -d postgres -c "DROP DATABASE IF EXISTS $SCRATCHDB WITH (FORCE)" | Out-Null
  Remove-Item $cloudDump, $schemaDump -Force -ErrorAction SilentlyContinue
}

Write-Host "5/5 Sales report for $ReportDate (local vs cloud_snapshot)..." -ForegroundColor Cyan
& $PSQL -U postgres -d $LOCALDB -v ON_ERROR_STOP=1 `
  -v report_date=$ReportDate `
  -v event_tz=$EVENT_TZ `
  -v cloud_naive_tz=$CLOUD_NAIVE_TZ `
  -P null='-' `
  -f $REPORT
if ($LASTEXITCODE -ne 0) { throw 'report failed' }

Write-Host ''
Write-Host 'Done. cloud_snapshot schema stays in rodeo_db for ad-hoc queries' -ForegroundColor Green
Write-Host '(e.g. SELECT COUNT(*) FROM cloud_snapshot.bar_transactions). Re-run'
Write-Host 'with -SkipSnapshot to re-print the report without re-downloading.'
