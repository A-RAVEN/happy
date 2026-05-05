# Happy Server one-click startup script
# Usage: powershell -ExecutionPolicy Bypass -File .\start-happy-server.ps1

$ErrorActionPreference = "Stop"

$IMAGE_NAME = "happy-server"
$CONTAINER_NAME = "happy-server"
$PORT = 3005
$MASTER_SECRET = "c43ec3fd-ff54-4e54-acb7-3fcb76b5bfad"
$DATA_VOLUME = "happy-data"

# 1. Check Docker is running
Write-Host "[1/4] Checking Docker..." -ForegroundColor Cyan
try {
    docker ps | Out-Null
    Write-Host "Docker is running" -ForegroundColor Green
} catch {
    Write-Host "Docker is not running. Start Docker Desktop first." -ForegroundColor Red
    exit 1
}

# 2. Build image
Write-Host "[2/4] Building Docker image..." -ForegroundColor Cyan
Push-Location $PSScriptRoot
docker build -t $IMAGE_NAME -f Dockerfile .
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    Pop-Location
    exit 1
}
Write-Host "Build succeeded" -ForegroundColor Green
Pop-Location

# 3. Remove old container
Write-Host "[3/4] Cleaning up old container..." -ForegroundColor Cyan
$existing = docker ps -a --filter "name=$CONTAINER_NAME" --format "{{.ID}}"
if ($existing) {
    docker stop $CONTAINER_NAME 2>$null
    docker rm $CONTAINER_NAME 2>$null
    Write-Host "Old container removed" -ForegroundColor Yellow
} else {
    Write-Host "No old container found" -ForegroundColor Green
}

# 4. Start container
Write-Host "[4/4] Starting Happy Server..." -ForegroundColor Cyan
docker run -d `
    --name $CONTAINER_NAME `
    -p ${PORT}:${PORT} `
    -e HANDY_MASTER_SECRET=$MASTER_SECRET `
    -e PORT=$PORT `
    -e NODE_ENV=development `
    -e METRICS_ENABLED=true `
    -e METRICS_PORT=9090 `
    -e DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING=true `
    -v ${DATA_VOLUME}:/data `
    --restart unless-stopped `
    $IMAGE_NAME

# 5. Verify
Write-Host "Waiting for server to start..." -ForegroundColor Cyan
Start-Sleep -Seconds 5

Write-Host "--- Container logs ---" -ForegroundColor DarkGray
docker logs $CONTAINER_NAME 2>&1
Write-Host "--- End of logs ---" -ForegroundColor DarkGray

try {
    $response = Invoke-WebRequest -Uri "http://localhost:${PORT}/ping" -UseBasicParsing -TimeoutSec 5
    Write-Host "Server is alive! http://localhost:${PORT}" -ForegroundColor Green
    Write-Host "Ping response: $($response.Content)" -ForegroundColor Green
} catch {
    Write-Host "Server may still be starting, check logs:" -ForegroundColor Yellow
    Write-Host "  docker logs -f $CONTAINER_NAME"
}

Write-Host ""
Write-Host "=== Commands ===" -ForegroundColor Cyan
Write-Host "View logs:    docker logs -f $CONTAINER_NAME"
Write-Host "Stop:         docker stop $CONTAINER_NAME"
Write-Host "Restart:      docker restart $CONTAINER_NAME"
Write-Host "Server URL:   http://localhost:$PORT"
