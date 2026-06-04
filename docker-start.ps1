#Requires -Version 5.1
<#
.SYNOPSIS
  One-command launcher for the Sahara Trade Intelligence Docker stack.

.DESCRIPTION
  Cold-starts (or resumes) the full local stack defined in docker-compose.yml:
  the Next.js app, the realtime WebSocket server, PostgreSQL and Redis.
  It does everything needed for a clean start:
    1. Detects `docker compose` (v2) or `docker-compose` (v1).
    2. Verifies the Docker engine is running (tries to start Docker Desktop).
    3. Bootstraps a .env from .env.example if one is missing.
    4. Builds images and brings the stack up.
    5. Waits for PostgreSQL and the app container to be ready.
    6. Syncs the Prisma schema into the database (prisma db push).
    7. Optionally seeds sample data.
    8. Prints the local URLs.

.PARAMETER Down
  Stop and remove containers + network. The Postgres data volume is kept.

.PARAMETER Reset
  DANGER: tear the stack down INCLUDING the Postgres data volume, then
  cold-start fresh. Use this when you want a clean database.

.PARAMETER Rebuild
  Force a clean image rebuild (--no-cache) before starting.

.PARAMETER Seed
  Run the Prisma seed script after the schema is synced.

.PARAMETER Logs
  Tail combined container logs after starting (Ctrl+C to detach).

.PARAMETER Status
  Show the current stack status and exit.

.EXAMPLE
  .\docker-start.ps1
  Cold-start (or resume) the whole stack.

.EXAMPLE
  .\docker-start.ps1 -Rebuild -Seed
  Rebuild images from scratch, start, sync the schema and seed sample data.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\docker-start.ps1
  Run it even if the local PowerShell execution policy blocks scripts.
#>
[CmdletBinding()]
param(
  [switch]$Down,
  [switch]$Reset,
  [switch]$Rebuild,
  [switch]$Seed,
  [switch]$Logs,
  [switch]$Status
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# Connection string as seen from *inside* the compose network (service DNS
# names, not localhost). Must match the postgres service credentials below.
$InternalDbUrl = 'postgresql://postgres:postgres@postgres:5432/sahara_trade?schema=public'

# --- console helpers --------------------------------------------------------
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    OK  $m" -ForegroundColor Green }
function Info($m) { Write-Host "    --  $m" -ForegroundColor DarkGray }
function Warn($m) { Write-Host "    !!  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "`nERROR: $m`n" -ForegroundColor Red; exit 1 }

# --- docker compose detection (v2 plugin or v1 standalone) ------------------
$script:ComposeExe = $null
$script:ComposePre = @()
function Resolve-Compose {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Die "Docker is not installed / not on PATH. Get Docker Desktop: https://www.docker.com/products/docker-desktop"
  }
  docker compose version *> $null
  if ($LASTEXITCODE -eq 0) { $script:ComposeExe = 'docker'; $script:ComposePre = @('compose'); return }
  if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
    $script:ComposeExe = 'docker-compose'; $script:ComposePre = @(); return
  }
  Die "Docker Compose is not available. Update Docker Desktop to a recent version."
}
function Compose { & $script:ComposeExe @($script:ComposePre + $args) }

# --- ensure the Docker engine is reachable ---------------------------------
function Assert-DockerRunning {
  Step 'Checking the Docker engine'
  docker info *> $null
  if ($LASTEXITCODE -eq 0) { Ok 'Docker engine is running'; return }

  Warn 'Docker engine is not responding - trying to start Docker Desktop...'
  $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $dd) {
    Start-Process -FilePath $dd | Out-Null
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 5
      docker info *> $null
      if ($LASTEXITCODE -eq 0) { Ok 'Docker engine is running'; return }
      Info 'waiting for Docker Desktop to finish starting...'
    }
  }
  Die "Docker engine is not running. Start Docker Desktop manually, then re-run."
}

# --- ensure a .env exists ---------------------------------------------------
function Assert-EnvFile {
  Step 'Checking the environment file'
  if (-not (Test-Path '.env')) {
    if (Test-Path '.env.example') {
      Copy-Item '.env.example' '.env'
      Warn '.env did not exist - created it from .env.example.'
      Warn 'Fill in real secrets (Dhan, Clerk, Gemini, ...) before going live.'
    } else {
      Die "No .env and no .env.example to copy from."
    }
  } else {
    Ok '.env present'
  }
  if (Select-String -Path '.env' -Pattern 'replace_me|replace_with' -Quiet) {
    Warn '.env still contains placeholder values. The stack will start, but'
    Warn 'broker / auth / AI features stay disabled until those are filled in.'
  }
}

# --- readiness waits --------------------------------------------------------
function Wait-Postgres {
  Step 'Waiting for PostgreSQL to accept connections'
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    Compose exec -T postgres pg_isready -U postgres -d sahara_trade *> $null
    if ($LASTEXITCODE -eq 0) { Ok 'PostgreSQL is ready'; return }
    Start-Sleep -Seconds 2
  }
  Die "PostgreSQL was not ready within 120s. Inspect: $script:ComposeExe logs postgres"
}
function Wait-App {
  Step 'Waiting for the app container'
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    Compose exec -T app node -e 'process.exit(0)' *> $null
    if ($LASTEXITCODE -eq 0) { Ok 'App container is up'; return }
    Start-Sleep -Seconds 3
  }
  Die "App container did not come up. Inspect: $script:ComposeExe logs app"
}

# --- database schema -------------------------------------------------------
function Sync-Schema {
  # The project ships a schema.prisma but no migration history, so `db push`
  # is the correct way to materialise the schema into a fresh database.
  Step 'Syncing the database schema (prisma db push)'
  Compose exec -T -e "DATABASE_URL=$InternalDbUrl" app npx prisma db push --skip-generate
  if ($LASTEXITCODE -ne 0) { Die "prisma db push failed - see output above." }
  Ok 'Database schema is in sync'
}
function Seed-Database {
  Step 'Seeding the database'
  Compose exec -T -e "DATABASE_URL=$InternalDbUrl" app npm run db:seed
  if ($LASTEXITCODE -ne 0) { Warn 'Seed script failed (continuing).' } else { Ok 'Seed complete' }
}

# ===========================================================================
try {
  Resolve-Compose
  Assert-DockerRunning

  if ($Status) { Step 'Stack status'; Compose ps; exit 0 }

  if ($Down) {
    Step 'Stopping the stack'
    Compose down
    Ok 'Stack stopped (Postgres data volume preserved).'
    exit 0
  }

  if ($Reset) {
    Step 'Resetting the stack (containers + data volume)'
    Compose down -v
    Ok 'Stack and data volume removed - starting fresh.'
  }

  Assert-EnvFile

  if ($Rebuild) {
    Step 'Rebuilding images from scratch (--no-cache)'
    Compose build --no-cache
    if ($LASTEXITCODE -ne 0) { Die "Image build failed - see output above." }
    Ok 'Images rebuilt'
  }

  Step 'Starting the stack'
  Compose up -d --build --remove-orphans
  if ($LASTEXITCODE -ne 0) { Die "docker compose up failed - see output above." }
  Ok 'Containers started'

  Wait-Postgres
  Wait-App
  Sync-Schema
  if ($Seed) { Seed-Database }

  # The realtime server reads the DB on boot, before the schema existed -
  # restart it (and the app) so they reconnect against the synced schema.
  Step 'Restarting app services against the synced schema'
  Compose restart app realtime *> $null
  Ok 'Services restarted'

  Step 'Stack is up'
  Compose ps
  Write-Host ''
  Write-Host '  App        ->  http://localhost:3000'                                  -ForegroundColor Green
  Write-Host '  Realtime   ->  ws://localhost:3001/ws'                                 -ForegroundColor Green
  Write-Host '  PostgreSQL ->  localhost:5432   (user/pass: postgres, db: sahara_trade)' -ForegroundColor Green
  Write-Host '  Redis      ->  localhost:6379'                                         -ForegroundColor Green
  Write-Host ''
  Info 'Stop:    .\docker-start.ps1 -Down'
  Info 'Logs:    .\docker-start.ps1 -Logs'
  Info 'Reset:   .\docker-start.ps1 -Reset    (wipes the database)'

  if ($Logs) { Step 'Tailing logs (Ctrl+C to detach)'; Compose logs -f }
}
catch {
  Die $_.Exception.Message
}
