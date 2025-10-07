# Interactive GitHub Deploy Script for PowerShell
# Includes custom commit messages, version confirmation, and auto-branch detection

Write-Host "`nStarting GitHub Deploy Wizard..." -ForegroundColor Cyan

# Detect current Git branch
$branch = git rev-parse --abbrev-ref HEAD 2>$null
if (-not $branch) {
    Write-Host "Error: Not inside a Git repository!" -ForegroundColor Red
    exit
}

Write-Host "Current branch: $branch" -ForegroundColor Yellow

# Get latest version tag or default
$ver = git describe --tags --abbrev=0 2>$null
if (-not $ver) { $ver = "v0.0.0" }

# Auto-bump patch version
$parts = $ver.TrimStart('v').Split('.')
$parts[-1] = [int]$parts[-1] + 1
$newVer = "v{0}.{1}.{2}" -f $parts[0], $parts[1], $parts[2]

# Ask for a custom commit message
$commitMsg = Read-Host "Enter your commit message"

# Confirm version bump
Write-Host "`nCurrent version: $ver"
Write-Host "Next version will be: $newVer"
$confirm = Read-Host "Proceed with this version? (y/n)"
if ($confirm -ne "y") {
    Write-Host "Deployment cancelled by user." -ForegroundColor Red
    exit
}

# Stage and commit changes
git add .
git commit -m "$commitMsg ($newVer)"

# Tag the new version
git tag $newVer

# Push commit and tag to current branch
Write-Host "`nPushing changes to origin/$branch ..." -ForegroundColor Cyan
git push origin $branch
git push origin --tags

# Show summary
Write-Host "`nSuccessfully deployed version $newVer!" -ForegroundColor Green
Write-Host "Commit message: $commitMsg"
Write-Host "Branch: $branch"
Write-Host "Repo: https://github.com/VAP333/WattAudit"
Write-Host ""
