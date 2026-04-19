Set-Location -LiteralPath $PSScriptRoot

$nodePath = "C:\Users\AAIConsultants\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (-not (Test-Path -LiteralPath $nodePath)) {
  Write-Host "Bundled Node runtime not found at:" -ForegroundColor Red
  Write-Host $nodePath -ForegroundColor Red
  Write-Host ""
  Write-Host "Please return to Codex and ask me to repair the launcher." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host ""
Write-Host "Starting HPE Mist Infrastructure Monitor..." -ForegroundColor Cyan
Write-Host "Open http://localhost:3000 in your browser." -ForegroundColor Green
Write-Host "Press Ctrl + C in this window when you want to stop it." -ForegroundColor Yellow
Write-Host ""

& $nodePath server.js
