@echo off
title CMA Software  -  keep this window open
cd /d "%~dp0"
echo.
echo    Starting CMA Software...
echo.

REM --- find Python (prefer "python", fall back to the "py" launcher) ---
set "PY="
where python >nul 2>nul
if not errorlevel 1 set "PY=python"
if not defined PY (
  where py >nul 2>nul
  if not errorlevel 1 set "PY=py"
)
if not defined PY goto :nopython

REM --- make sure the PDF-reading component is installed (first run only) ---
%PY% -c "import fitz" >nul 2>nul
if errorlevel 1 (
  echo    First-time setup: installing a needed component ^(about a minute^)...
  %PY% -m pip install --quiet --user pymupdf
)

REM --- run the app (this also opens it in Chrome) ---
%PY% "%~dp0server.py"
echo.
echo    CMA Software has stopped. You can close this window.
pause
exit /b 0

:nopython
echo    Could not find Python on this computer.
echo    Please install it from  https://www.python.org/downloads/
echo    During install, tick "Add Python to PATH", then run this again.
echo.
pause
exit /b 1
