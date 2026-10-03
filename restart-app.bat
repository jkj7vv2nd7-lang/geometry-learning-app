@echo off
cd /d "%~dp0"
echo [geometry-app] stopping old server...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*uvicorn*main:app*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*uvicorn*main:app*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 3 /nobreak >nul
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
echo [geometry-app] starting server in background (reads your API keys now)...
set AUTO_SHUTDOWN=1
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%PYW%' -ArgumentList '-m','uvicorn','main:app','--port','8000' -WorkingDirectory '%CD%' -WindowStyle Hidden -RedirectStandardOutput 'server.log' -RedirectStandardError 'server-err.log'"
timeout /t 8 /nobreak >nul
curl.exe -s -m 5 http://localhost:8000/api/health >nul 2>&1
if not %errorlevel%==0 (
  echo [ERROR] server did not start. Last log:
  if exist server.log type server.log
  if exist server-err.log type server-err.log
  pause
  exit /b 1
)
echo [geometry-app] server restarted.
echo [geometry-app] opening browser...
start "" http://localhost:8000
echo Done. The server ends by itself about 2 minutes after you close the browser tab.
timeout /t 3 /nobreak >nul
exit /b 0
