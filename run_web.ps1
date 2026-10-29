# RideBalance Web Application Launcher
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Starting RideBalance Web Application...    " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Start FastAPI backend on port 8000
Write-Host "[1/2] Starting Python FastAPI backend (http://localhost:8000)..." -ForegroundColor Yellow
$backend = Start-Process -FilePath "python" -ArgumentList "-m uvicorn api:app --host 0.0.0.0 --port 8000" -PassThru -NoNewWindow

Start-Sleep -Seconds 2

# Start Vite React frontend on port 5173
Write-Host "[2/2] Starting React frontend (http://localhost:5173)..." -ForegroundColor Yellow
Set-Location -Path "$PSScriptRoot\web"
$frontend = Start-Process -FilePath "npm" -ArgumentList "run dev -- --host" -PassThru -NoNewWindow

Write-Host ""
Write-Host "RideBalance is now running!" -ForegroundColor Green
Write-Host "Open your browser at: http://localhost:5173" -ForegroundColor White -BackgroundColor DarkGreen
Write-Host "Backend API docs at:  http://localhost:8000/docs" -ForegroundColor Gray
Write-Host "Press Ctrl+C or close this terminal to stop." -ForegroundColor Gray

try {
    Wait-Process -Id $frontend.Id
} finally {
    Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue
}
