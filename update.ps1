# WattAudit Safe Update & Backup Script
Write-Host ""
Write-Host "=== Syncing with Main and Backing Up Work ===" -ForegroundColor Cyan

# Verify git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git is not installed. Install it from https://git-scm.com/downloads" -ForegroundColor Red
    exit
}

# Step 1: Auto-commit local progress before syncing
$changes = git status --porcelain
if ($changes) {
    Write-Host "`nCommitting local changes before sync..." -ForegroundColor Yellow
    git add .
    git commit -m "Auto backup before syncing with main"
} else {
    Write-Host "`nNo uncommitted changes found." -ForegroundColor Green
}

# Step 2: Fetch latest from GitHub
Write-Host "`nFetching latest from origin/main..." -ForegroundColor Yellow
git fetch origin

# Step 3: Detect current branch
$currentBranch = git rev-parse --abbrev-ref HEAD
Write-Host "`nCurrent branch: $currentBranch" -ForegroundColor Green

# Step 4: Merge or pull main
if ($currentBranch -eq "main") {
    git pull origin main
} else {
    git merge origin/main
}

# Step 5: Push branch so team can see progress
Write-Host "`nPushing your branch to GitHub..." -ForegroundColor Yellow
git push origin $currentBranch

Write-Host "`nUpdate complete! Your branch is now in sync and backed up." -ForegroundColor Green
Write-Host ""
