@echo off
setlocal
cd /d "%~dp0"

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

echo Build complete: dist
