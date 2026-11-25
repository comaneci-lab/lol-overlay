@echo off
setlocal
cd /d "%~dp0"

python scripts\write_build_version.py --interactive
if errorlevel 1 exit /b %errorlevel%

python -m PyInstaller --noconfirm --clean LoLAPIGet.spec
if errorlevel 1 exit /b %errorlevel%

xcopy "html" "dist\html\" /E /I /Y >nul
if errorlevel 1 exit /b 1
xcopy "css" "dist\css\" /E /I /Y >nul
if errorlevel 1 exit /b 1
xcopy "js" "dist\js\" /E /I /Y >nul
if errorlevel 1 exit /b 1
xcopy "assets" "dist\assets\" /E /I /Y >nul
if errorlevel 1 exit /b 1
xcopy "config" "dist\config\" /E /I /Y >nul
if errorlevel 1 exit /b 1

python scripts\write_app_update_manifest.py
if errorlevel 1 exit /b %errorlevel%

type nul > "dist\.dev-environment"
if errorlevel 1 exit /b 1

python scripts\write_build_version.py --push-tag
if errorlevel 1 exit /b %errorlevel%

echo Build complete: dist (remove .dev-environment before distribution)
