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
echo [geometry-app] locating real python...
set "PYW="
for /f "delims=" %%E in ('python -c "import sys; print(sys.executable)" 2^>nul') do set "PYW=%%~dpEpythonw.exe"
if not defined PYW (
  echo [ERROR] python not found. Install Python 3.10+ and retry.
  pause
  exit /b 1
)
if not exist "%PYW%" (
  echo [ERROR] pythonw.exe not found next to python. Reinstall Python.
  pause
  exit /b 1
)
echo [geometry-app] starting server in background (no console window)...
echo [geometry-app] The server ends by itself about 2 minutes after you close the browser tab.
set AUTO_SHUTDOWN=1
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%PYW%' -ArgumentList '-m','uvicorn','main:app','--port','8000' -WorkingDirectory '%CD%' -WindowStyle Hidden -RedirectStandardOutput 'server.log' -RedirectStandardError 'server-err.log'"
timeout /t 8 /nobreak >nul
curl.exe -s -m 3 http://localhost:8000/api/health >nul 2>&1
if not %errorlevel%==0 (
  echo [ERROR] server did not start. Last log:
  if exist server.log type server.log
  if exist server-err.log type server-err.log
  pause
  exit /b 1
)
echo [geometry-app] server started. Opening browser...
start "" http://localhost:8000
echo Done. This window will close by itself.
timeout /t 3 /nobreak >nul
exit /b 0
