@echo off
cd /d "%~dp0"
echo [geometry-app] checking server...
curl.exe -s -m 2 http://localhost:8000/api/health >nul 2>&1
if %errorlevel%==0 (
  echo [geometry-app] server already running. Opening browser...
  start "" http://localhost:8000
  echo Done. You can close this window.
  pause
  exit /b 0
)
where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] python not found. Install Python 3.10+ and retry.
  pause
  exit /b 1
)
echo [geometry-app] starting server on http://localhost:8000 ...
echo Close THIS window to stop the server.
timeout /t 2 /nobreak >nul
start "" http://localhost:8000
python -m uvicorn main:app --port 8000
echo.
echo [geometry-app] server stopped.
pause
