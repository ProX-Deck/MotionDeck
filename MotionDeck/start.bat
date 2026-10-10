@echo off
chcp 65001 >nul
REM ============================================================
REM MotionDeck launcher (Windows) - Double-click to run.
REM Pure ASCII only (cmd.exe + multibyte = broken lines). All
REM Chinese/emoji output comes from node (server.mjs, UTF-8 safe).
REM
REM GOLDEN RULE - learned the hard way, twice:
REM   NEVER put parentheses "(...)" inside echo text that sits inside an
REM   "if ( ... )" block. cmd counts parens at PARSE time: the "(" opens a
REM   nested compound, ")" closes it, and whatever follows becomes a new
REM   command -> "X was unexpected at this time." and the script aborts
REM   right there. Symptom: the server banner prints, then the script dies
REM   silently before any dependency check runs. Prefer goto over blocks,
REM   and keep parens out of user-facing text entirely.
REM
REM New flow (v1.2.x):
REM   1. Resolve Node.js.
REM   2. Launch server.mjs in BACKGROUND. It negotiates its own port
REM      (80 -> 8080 -> ...) and opens the default browser itself, so
REM      this launcher does NOT probe or detect anything.
REM   3. Check export deps: node_modules/puppeteer and ffmpeg/ffprobe.
REM      Anything missing or broken is repaired automatically, no prompt.
REM   4. Keep the window open; press Ctrl+C to stop the server.
REM ============================================================
cd /d "%~dp0"

REM Remove broker file-hook (WorkBuddy/CodeBuddy) if present
set "NODE_OPTIONS="

REM Resolve Node.js: prefer WorkBuddy built-in managed node, fall back to system PATH
set "NODE_BIN="
for /d %%p in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
  if exist "%%p\node.exe" set "NODE_BIN=%%p\node.exe"
  if not defined NODE_BIN if exist "%%p\bin\node.exe" set "NODE_BIN=%%p\bin\node.exe"
)
if not defined NODE_BIN (
  where node >nul 2>nul && set "NODE_BIN=node"
)
if not defined NODE_BIN (
  echo [X] Node.js not found. Please install Node.js ^>= 22.12 : https://nodejs.org
  echo.
  pause
  exit /b 1
)

REM ============================================================
REM Domestic npm mirror - DEFAULT for every install.
REM Google and GitHub are unreliable for CN users, so each downloadable
REM dependency is pulled from npmmirror:
REM   - npm registry        -> registry.npmmirror.com        - JS packages
REM   - puppeteer Chromium   -> npmmirror binary mirror        - was Google CDN
REM   - ffmpeg-static binary -> npmmirror binary mirror        - was GitHub
REM NOTE: ffprobe-static bundles its binary inside the npm tarball, so the
REM registry setting alone covers it. These only affect this launch - they do
REM NOT modify the user's global npm config.
REM ============================================================
set "NPM_REGISTRY=https://registry.npmmirror.com"
set "PUPPETEER_DOWNLOAD_BASE_URL=https://registry.npmmirror.com/-/binary/chrome-for-testing"
set "FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static"

REM Add node dir to PATH (so npm/node resolve). Also pre-add ffmpeg-static /
REM ffprobe-static dirs to PATH: they may not exist yet, but Windows only
REM checks directory existence at child-spawn time, so once npm installs them
REM the already-running server will find ffmpeg without a restart.
set "PATH=%NODE_BIN%\..;%CD%\node_modules\ffmpeg-static;%CD%\node_modules\ffprobe-static;%PATH%"
REM MD = script dir with backslashes -> forward slashes (safe to embed in a JS string)
set "MD=%CD:\=/%"

REM Port 80 needs Administrator on Windows. If 80 is unavailable (no admin /
REM taken), server.mjs auto-falls back to 8080 and opens the browser at
REM whatever port it actually bound to.
net session >nul 2>&1
if errorlevel 1 (
  echo [i] Not running as Administrator - port 80 may be unavailable.
  echo     No problem: the server will auto-use 8080 or another free port, and open it.
  echo     For port 80 itself: right-click and "Run as administrator".
  echo.
) else (
  echo [*] Running as Administrator - port 80 available.
  echo.
)

REM ============================================================
REM Phase 1: launch server - it opens the workbench itself
REM ============================================================
REM server.mjs binds a port itself (80 -> 8080 -> ...) and calls openBrowser()
REM as soon as it is listening, so this launcher needs no port detection and
REM no readiness probe at all. We only mirror its banner so the URL is visible.
echo [*] Starting MotionDeck server in background...
REM Output is NOT redirected to a file: server.mjs inherits this console,
REM so export progress ([export] ...) shows live in this window.
start "MotionDeck" /B "%NODE_BIN%" server.mjs

REM Short pause so the server can bind and print its banner.
timeout /t 2 >nul
echo.

REM ============================================================
REM Phase 2: export deps - auto-install, NO prompt
REM ============================================================
call :CHECK_DEPS

REM ============================================================
REM Phase 3: ffmpeg/ffprobe - auto-install if missing, NO prompt
REM ============================================================
call :CHECK_FFMPEG
echo.
echo [i] All checks done. The workbench is usable for preview and import now.
echo     Missing deps only affect video export.
echo.
echo [*] MotionDeck is running. Press Ctrl+C to stop the server and exit.
echo.
REM Ctrl+C is the only way out of this loop: /NOBREAK makes timeout ignore
REM ordinary key presses, so a stray keypress can no longer shut the server
REM down. Ctrl+C reaches every process attached to the console, so it stops
REM both this launcher and the background server.
:WAIT
timeout /t 3600 /nobreak >nul 2>nul
goto :WAIT

:CHECK_DEPS
REM No interaction here: the workbench is already up and running, so if the
REM export deps are missing or broken we simply (re)install them.
REM Detection is NOT just "does the folder exist" - we actually ask node to
REM resolve puppeteer, so a half-written / corrupt node_modules is caught too.
set "NEED_INSTALL=0"
if not exist "node_modules" set "NEED_INSTALL=1"
if not exist "node_modules\puppeteer" set "NEED_INSTALL=1"
REM paths:[cwd] pins resolution to this project, so a puppeteer installed
REM somewhere global cannot make a broken local node_modules look "ready".
"%NODE_BIN%" -e "try{require.resolve('puppeteer',{paths:[process.cwd()]});process.exit(0)}catch(e){process.exit(1)}" >nul 2>&1
if errorlevel 1 set "NEED_INSTALL=1"
REM NOTE: keep parentheses OUT of echo text inside an "if ( ... )" block.
REM cmd counts ( ) at PARSE time, so "echo ready (puppeteer)." inside a block
REM opens a nested compound at "(", closes it at ")", and the leftover "." is
REM then parsed as a command -> ". was unexpected at this time." and the whole
REM block (and the rest of the script) is aborted. That is exactly the bug that
REM killed this launcher after the server banner. Use goto instead of a block.
if not "%NEED_INSTALL%"=="0" goto :DEPS_INSTALL
echo [OK] node_modules is ready - puppeteer resolves.
goto :eof
:DEPS_INSTALL
echo [*] node_modules is missing or incomplete - installing export deps now...
echo     Only video export needs this; the workbench already works.
call npm install --registry=%NPM_REGISTRY%
if errorlevel 1 ( echo [X] npm install failed. Run "npm install" manually. & goto :eof )
echo [OK] node_modules installed.
echo     Note: if export later reports a missing Chromium, run: npm run setup
goto :eof

:CHECK_FFMPEG
REM Same rule as node_modules: no interaction. If the system has no ffmpeg /
REM ffprobe on PATH, install the npm binaries. Note a system ffmpeg (e.g. an
REM existing C:\ffmpeg) is detected first and never replaced.
set "FF_OK=0"
set "FFP_OK=0"
where ffmpeg >nul 2>nul && set "FF_OK=1"
where ffprobe >nul 2>nul && set "FFP_OK=1"
if "%FF_OK%"=="1" if "%FFP_OK%"=="1" ( echo [OK] ffmpeg and ffprobe are ready. & goto :eof )
if "%FF_OK%"=="1" if not "%FFP_OK%"=="1" echo [!] ffprobe is missing although ffmpeg exists.
echo [*] ffmpeg or ffprobe not on PATH - installing via npm, export needs them...
call npm install ffmpeg-static ffprobe-static --no-save --registry=%NPM_REGISTRY%
if errorlevel 1 ( echo [X] Install failed. Install ffmpeg manually and add to PATH. & goto :eof )
REM Put BOTH binaries into one directory that is already on PATH (see the PATH
REM line at the top): node_modules/ffmpeg-static. This is layout-independent -
REM ffmpeg-static keeps its binary at the package root while ffprobe-static
REM keeps it under bin/<platform>/<arch>/, so we cannot just add both package
REM dirs to PATH. Resolving via require() also covers the fact that
REM ffmpeg-static exports a string while ffprobe-static exports {path}.
REM Copying into a PATH dir is what lets the ALREADY-RUNNING server find them
REM without a restart.
REM The JS below deliberately avoids | > & characters: even inside double
REM quotes those are the classic cmd parsing landmines.
"%NODE_BIN%" -e "const fs=require('fs'),P=require('path'),X=process.platform==='win32'?'.exe':'',D=process.cwd()+'/node_modules/ffmpeg-static';fs.mkdirSync(D,{recursive:true});function R(m){try{var x=require(m);return typeof x==='string'?x:(x?x.path:null)}catch(e){return null}};function C(s,n){if(s==null)return 0;var d=P.join(D,n+X);try{if(fs.existsSync(d)){if(fs.realpathSync(s)===fs.realpathSync(d))return 1};fs.copyFileSync(s,d);if(X==='')fs.chmodSync(d,493);return 1}catch(e){return 0}};var a=C(R('ffmpeg-static'),'ffmpeg'),b=C(R('ffprobe-static'),'ffprobe');console.log('    ffmpeg='+a+' ffprobe='+b);"
echo [OK] ffmpeg and ffprobe installed into node_modules, on PATH for this session.
goto :eof
