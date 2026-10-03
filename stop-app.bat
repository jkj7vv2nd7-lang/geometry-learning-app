@echo off
cd /d "%~dp0"
echo [geometry-app] stopping server...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*uvicorn*main:app*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*uvicorn*main:app*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 2 /nobreak >nul
curl.exe -s -m 2 http://localhost:8000/api/health >nul 2>&1
if %errorlevel%==0 (
  echo [geometry-app] server is still running.
) else (
  echo [geometry-app] server stopped.
)
timeout /t 3 /nobreak >nul
exit /b 0
