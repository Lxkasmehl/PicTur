# new-worktree.ps1
# Usage: .\scripts\new-worktree.ps1 -Branch "admin/mein-feature"

param(
    [Parameter(Mandatory = $true)]
    [string]$Branch
)

# Determine the root of the main worktree (where this script lives + ..)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MainDir = Split-Path -Parent $ScriptDir

# Derive the target folder name from the branch (replace slashes with dashes)
$FolderName = $Branch -replace "/", "-"
$TargetDir = Join-Path (Split-Path -Parent $MainDir) $FolderName

Write-Host "Creating worktree for branch '$Branch' at '$TargetDir'..." -ForegroundColor Cyan

# Create the worktree
Push-Location $MainDir
git worktree add $TargetDir $Branch
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to create worktree. Aborting." -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# Files to copy (relative to main worktree root)
$FilesToCopy = @(
    ".env",
    "CLAUDE.md",
    "github_actions_deploy",
    "github_actions_deploy.pub",
    "project-query.graphql",
    "backend\.env",
    "backend\general_locations.json",
    "frontend\.env",
    "auth-backend\.env"
)

# Folders to copy recursively
$FoldersToCopy = @(
    "backend\credentials",
    "auth-backend\data"
)

Write-Host "Copying untracked files..." -ForegroundColor Cyan

foreach ($RelativePath in $FilesToCopy) {
    $Source = Join-Path $MainDir $RelativePath
    $Destination = Join-Path $TargetDir $RelativePath

    if (Test-Path $Source) {
        $DestDir = Split-Path -Parent $Destination
        if (-not (Test-Path $DestDir)) {
            New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
        }
        Copy-Item -Path $Source -Destination $Destination -Force
        Write-Host "  Copied: $RelativePath" -ForegroundColor Green
    } else {
        Write-Host "  Skipped (not found): $RelativePath" -ForegroundColor Yellow
    }
}

foreach ($RelativePath in $FoldersToCopy) {
    $Source = Join-Path $MainDir $RelativePath
    $Destination = Join-Path $TargetDir $RelativePath

    if (Test-Path $Source) {
        Copy-Item -Path $Source -Destination $Destination -Recurse -Force
        Write-Host "  Copied folder: $RelativePath" -ForegroundColor Green
    } else {
        Write-Host "  Skipped (not found): $RelativePath" -ForegroundColor Yellow
    }
}

# Run npm install in parallel for frontend and auth-backend
Write-Host ""
Write-Host "Running npm install in parallel for frontend and auth-backend..." -ForegroundColor Cyan

$NpmJobs = @()

foreach ($NodeDir in @("frontend", "auth-backend")) {
    $FullPath = Join-Path $TargetDir $NodeDir
    if (Test-Path (Join-Path $FullPath "package.json")) {
        $job = Start-Job -ScriptBlock {
            param($path, $dir)
            Set-Location $path
            $output = npm install 2>&1
            return @{ Dir = $dir; Output = $output; ExitCode = $LASTEXITCODE }
        } -ArgumentList $FullPath, $NodeDir
        $NpmJobs += $job
        Write-Host "  Started: npm install in $NodeDir" -ForegroundColor Green
    } else {
        Write-Host "  Skipped (no package.json): $NodeDir" -ForegroundColor Yellow
    }
}

# Wait for all npm install jobs to finish
Write-Host "  Waiting for npm installs to complete..." -ForegroundColor Cyan
foreach ($job in $NpmJobs) {
    $result = Receive-Job -Job $job -Wait
    Remove-Job -Job $job
    if ($result.ExitCode -eq 0) {
        Write-Host "  Done: npm install in $($result.Dir)" -ForegroundColor Green
    } else {
        Write-Host "  Failed: npm install in $($result.Dir)" -ForegroundColor Red
        Write-Host $result.Output -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Done! Worktree ready at: $TargetDir" -ForegroundColor Green