@echo off
setlocal
cd /d "%~dp0"
title FAULTWARD
set "PATH=%CD%\runtime;%PATH%"
if not exist "runtime\node.exe" (
  echo This portable launcher needs the runtime folder supplied in the final ZIP.
  pause
  exit /b 1
)
if not exist "client\dist\game-assets.json" (
  echo The prebuilt game assets are missing. Extract the complete ZIP again.
  pause
  exit /b 1
)
set "PORT="
for /f "usebackq delims=" %%p in (`node scripts\preflight.mjs --port`) do set "PORT=%%p"
if not defined PORT exit /b 1
echo Starting FAULTWARD at http://127.0.0.1:%PORT%/
echo Close this window or press Ctrl+C to stop the game server.
start "" /b node scripts\preflight.mjs --open %PORT%
node server\dist\main.mjs
pause
