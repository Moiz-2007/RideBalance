@echo off
echo =============================================
echo  Starting RideBalance Web Application...
echo =============================================

echo [1/2] Starting Python FastAPI backend on port 8000...
start "RideBalance API Backend" python -m uvicorn api:app --host 0.0.0.0 --port 8000

echo [2/2] Starting React Vite frontend on port 5173...
cd web
start "RideBalance Web Frontend" npm run dev -- --host

echo.
echo RideBalance is starting!
echo Open your browser at: http://localhost:5173
echo Backend API Docs at:  http://localhost:8000/docs
echo.
