@echo off
cd /d "%~dp0"
echo [geometry-app] checking server...
curl.exe -s -m 2 http://localhost:8000/api/health >nul 2>&1
if %errorlevel%==0 (
  echo [geometry-app] server already running. Opening browser...
  start "" http://localhost:8000
  echo Done. This window will close by itself.
  timeout /t 3 /nobreak >nul
  exit /b 0
)
where pythonw >nul 2>&1
if errorlevel 1 (
  echo [ERROR] pythonw not found. Install Python 3.10+ and retry.
  pause
  exit /b 1
)
echo [geometry-app] starting server in background (no console window)...
echo [geometry-app] The server ends by itself about 2 minutes after you close the browser tab.
set AUTO_SHUTDOWN=1
start "" /min pythonw -m uvicorn main:app --port 8000
timeout /t 6 /nobreak >nul
curl.exe -s -m 3 http://localhost:8000/api/health >nul 2>&1
if not %errorlevel%==0 (
  echo [ERROR] server did not start. Run restart-app.bat and check the message.
  pause
  exit /b 1
)
echo [geometry-app] server started. Opening browser...
start "" http://localhost:8000
echo Done. This window will close by itself.
timeout /t 3 /nobreak >nul
exit /b 0
