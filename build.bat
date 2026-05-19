@echo off
echo ============================================
echo  Finance Tracker -- Desktop App Builder
echo ============================================
echo.

echo [1/2] Installing PyInstaller...
py -m pip install pyinstaller --quiet
if errorlevel 1 ( echo ERROR: pip failed & pause & exit /b 1 )

echo [2/2] Building app...
py -m PyInstaller ^
  --onedir ^
  --windowed ^
  --name "FinanceTracker" ^
  --add-data "web;web" ^
  --exclude-module "webview" ^
  --exclude-module "pywebview" ^
  --exclude-module "pythonnet" ^
  --exclude-module "clr" ^
  --exclude-module "clr_loader" ^
  --exclude-module "PySide6" ^
  --exclude-module "PyQt5" ^
  --exclude-module "PyQt6" ^
  --clean ^
  --noconfirm ^
  main.py

if errorlevel 1 ( echo ERROR: Build failed & pause & exit /b 1 )

echo.
echo ============================================
echo  BUILD SUCCESSFUL
echo ============================================
echo.
echo  Your app is ready at:
echo  dist\FinanceTracker\FinanceTracker.exe
echo.
echo  To distribute:
echo    1. Zip the entire dist\FinanceTracker folder.
echo    2. Recipient extracts the zip and runs FinanceTracker.exe.
echo    3. A fresh empty finance.db is created on first run.
echo.
echo  NOTE: this script does NOT copy your local finance.db into
echo  the build. Distribute clean builds only. Your borrower data
echo  stays where it currently is.
echo.
pause
