<#
  Cloud -> local warm-standby mirror   (CLOUD-PRIMARY event mode)

  The event runs LIVE on the cloud (Railway). This script keeps the local NUC
  database as a continuously-refreshed BACKUP copy, so if the internet fails you
  can fail over to the local site with data that is at most $IntervalMinutes old.

  Normal operation: NOTHING writes to the local DB -- it is a read-only mirror.
  Each cycle fully replaces the local contents with a fresh copy of the cloud.
  That overwrite is SAFE precisely because the local DB holds no live writes
  while the cloud is the source of truth.

  >>> IF THE INTERNET FAILS: see the FAILOVER steps in CLOUD-BACKUP.md.
  >>> Failover step 1 is ALWAYS "STOP this mirror", or the next refresh will
  >>> overwrite everything you take on the local system during the outage.

  Do NOT also run ticket-sync.ps1 -- that one is for the local-primary plan.

  Prep (run once, then reopen the window):
    setx PROD_URL   "postgresql://postgres:PASSWORD@mainline.proxy.rlwy.net:31899/railway"
    setx PGPASSWORD "<LOCAL postgres password>"
#>
param([int]$IntervalMinutes = 5)

$PGDUMP = "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"
$PSQL   = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
$DUMP   = "C:\rodeo\cloud-backup.sql"
$CLOUD  = $env:PROD_URL

if (-not (Test-Path $PGDUMP)) { Write-Error "pg_dump not found at $PGDUMP"; exit 1 }
if (-not $CLOUD)              { Write-Error "PROD_URL not set (cloud connection string). See prep above."; exit 1 }
if (-not $env:PGPASSWORD)     { Write-Error "PGPASSWORD not set (LOCAL postgres password). See prep above."; exit 1 }

$seconds = [Math]::Max(60, $IntervalMinutes * 60)
Write-Host "Cloud -> local mirror running every $IntervalMinutes min.  Ctrl-C to stop."
Write-Host "The local DB is a BACKUP MIRROR. Do not enter live data on it while the cloud is up."
while ($true) {
  $t = Get-Date -Format 'HH:mm:ss'
  try {
    # 1. Fresh full dump of the CLOUD (--clean --if-exists so it replaces local contents
    #    without having to drop the database, so an idle RodeoAPI connection is fine).
    & $PGDUMP --clean --if-exists --no-owner --no-acl -d "$CLOUD" -f $DUMP
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE) -- cloud unreachable / internet down?" }

    # 2. Restore into the local standby database.
    & $PSQL -U postgres -d rodeo_db -f $DUMP *> $null

    # 3. Sanity readout so the log proves the mirror is fresh.
    $tickets = ((& $PSQL -U postgres -d rodeo_db -tAc "SELECT count(*) FROM ticket_orders") -join '').Trim()
    $bands   = ((& $PSQL -U postgres -d rodeo_db -tAc "SELECT count(*) FROM wristbands")     -join '').Trim()
    Write-Host ("{0}  mirror OK    tickets={1}  wristbands={2}" -f $t, $tickets, $bands)
  } catch {
    Write-Warning ("{0}  MIRROR FAILED: {1}" -f $t, $_)
    Write-Warning "  If the internet is DOWN and you need to run on local, STOP this script now and follow the FAILOVER steps in CLOUD-BACKUP.md."
  }
  Start-Sleep -Seconds $seconds
}
