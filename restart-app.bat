@echo off
cd /d "%~dp0"
echo [geometry-app] stopping old server...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*uvicorn*main:app*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*uvicorn*main:app*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 3 /nobreak >nul
echo [geometry-app] starting server in background (reads your API keys now)...
set AUTO_SHUTDOWN=1
start "" /min pythonw -m uvicorn main:app --port 8000
timeout /t 6 /nobreak >nul
curl.exe -s -m 5 http://localhost:8000/api/health
echo.
echo [geometry-app] opening browser...
start "" http://localhost:8000
echo Done. The server ends by itself about 2 minutes after you close the browser tab.
timeout /t 3 /nobreak >nul
exit /b 0
