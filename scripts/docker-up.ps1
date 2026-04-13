param(
    [switch]$CpuOnly
)

$ErrorActionPreference = "Stop"

function Start-CpuCompose {
    Write-Host "Starting PicTur in CPU mode..."
    docker compose -f docker-compose.yml up --build
    exit $LASTEXITCODE
}

if ($CpuOnly) {
    Start-CpuCompose
}

$dockerInfo = ""
try {
    $dockerInfo = docker info 2>$null | Out-String
} catch {
    Write-Warning "Could not read Docker info. Falling back to CPU mode."
    Start-CpuCompose
}

$hasNvidiaRuntime = $dockerInfo -match "nvidia"
if (-not $hasNvidiaRuntime) {
    Write-Host "NVIDIA runtime not detected. Falling back to CPU mode..."
    Start-CpuCompose
}

Write-Host "NVIDIA runtime detected. Starting PicTur in GPU mode..."
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build

if ($LASTEXITCODE -eq 0) {
    exit 0
}

Write-Warning "GPU compose startup failed. Retrying in CPU mode..."
Start-CpuCompose
