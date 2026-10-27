@echo off
setlocal
cd /d "%~dp0"

python -m PyInstaller --noconfirm --clean --onefile --name LoLAPIGet LoLProxy.py
if errorlevel 1 exit /b %errorlevel%

echo Build complete: dist\LoLAPIGet.exe
