# PowerShell script to install extension in VS Code
Write-Host "=== MultiPost Extension Installation Guide ===" -ForegroundColor Green
Write-Host ""
Write-Host "1. Open VS Code" -ForegroundColor Yellow
Write-Host "2. Go to Extensions view (Ctrl+Shift+X)" -ForegroundColor Yellow
Write-Host "3. Click the '...' menu (More Actions)" -ForegroundColor Yellow
Write-Host "4. Select 'Install from VSIX...'" -ForegroundColor Yellow
Write-Host "5. Select: $PSScriptRoot\multipost-0.1.10.vsix" -ForegroundColor Yellow
Write-Host ""
Write-Host "=== After Installation ===" -ForegroundColor Green
Write-Host "1. Open a .md file (e.g., CHANGELOG.md in this folder)" -ForegroundColor Yellow
Write-Host "2. Check Output panel (Ctrl+Shift+U) -> Select 'MultiPost'" -ForegroundColor Yellow
Write-Host "3. If no 'MultiPost' output, check Developer Tools (Ctrl+Shift+P -> 'Developer: Toggle Developer Tools')" -ForegroundColor Yellow
Write-Host ""
Write-Host "=== Troubleshooting ===" -ForegroundColor Red
Write-Host "If extension doesn't work:" -ForegroundColor Red
Write-Host "1. Developer: Reload Window" -ForegroundColor Yellow
Write-Host "2. Check Developer Tools Console for errors" -ForegroundColor Yellow
Write-Host "3. Uninstall and reinstall extension" -ForegroundColor Yellow