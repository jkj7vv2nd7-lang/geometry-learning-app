@echo off
cd /d "%~dp0"
echo [geometry-app] stopping old server...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*uvicorn*main:app*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 3 /nobreak >nul
echo [geometry-app] starting server (reads your API keys now)...
start "geometry-app" python -m uvicorn main:app --port 8000
timeout /t 6 /nobreak >nul
curl.exe -s -m 5 http://localhost:8000/api/health
echo.
echo [geometry-app] opening browser...
start "" http://localhost:8000
echo Done. Keep the "geometry-app" window open while using the app.
pause
