@echo off
setlocal
cd /d "%~dp0"

python -m PyInstaller --noconfirm --clean LoLAPIGet.spec
if errorlevel 1 exit /b %errorlevel%

echo Build complete: dist\LoLAPIGet.exe
