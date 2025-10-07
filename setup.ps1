# WattAudit Collaborator Setup Script
Write-Host ""
Write-Host "=== Setting up WattAudit Development Environment ===" -ForegroundColor Cyan

# Check Git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git is not installed. Install it from https://git-scm.com/downloads" -ForegroundColor Red
    exit
}

# Ask username
$username = Read-Host "Enter your GitHub username"

# Clone repo
$repoUrl = "https://github.com/VAP333/WattAudit.git"
$folder  = "WattAudit"

if (Test-Path $folder) {
    Write-Host "Repository already exists. Skipping clone."
    Set-Location $folder
} else {
    git clone $repoUrl
    Set-Location $folder
}

# Create personal branch
$branchName = "feature/$username-" + (Get-Date -Format "MMdd-HHmm")
git checkout -b $branchName
Write-Host "`nCreated and switched to branch: $branchName" -ForegroundColor Green

# Install dependencies (optional)
if (Test-Path "package.json") {
    Write-Host "`nInstalling Node dependencies..."
    npm install
}

# Create a default .env file if missing
if (-not (Test-Path ".env")) {
@"
# Environment Variables for WattAudit
NEXT_PUBLIC_API_URL=http://localhost:3000/api
"@ | Out-File -Encoding UTF8 .env
Write-Host "Created default .env file (fill in local values)."
}

Write-Host "`nSetup complete!"
Write-Host "You are now on your own branch: $branchName"
Write-Host "To share work later, run ./update.ps1 or:"
Write-Host "   git add ."
Write-Host "   git commit -m 'your message'"
Write-Host "   git push origin $branchName"
Write-Host ""
