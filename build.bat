@echo off
echo ============================================
echo  Finance Tracker — Desktop App Builder
echo ============================================
echo.

echo [1/3] Installing PyInstaller...
py -m pip install pyinstaller --quiet
if errorlevel 1 ( echo ERROR: pip failed & pause & exit /b 1 )

echo [2/3] Building app...
py -m PyInstaller ^
  --onedir ^
  --windowed ^
  --name "FinanceTracker" ^
  --add-data "web;web" ^
  --hidden-import "webview.platforms.edgechromium" ^
  --hidden-import "webview.platforms.winforms" ^
  --clean ^
  --noconfirm ^
  main.py

if errorlevel 1 ( echo ERROR: Build failed & pause & exit /b 1 )

echo [3/3] Copying existing database...
if exist finance.db (
  copy /Y finance.db dist\FinanceTracker\finance.db
  echo   Copied finance.db to app folder.
) else (
  echo   No finance.db found — app will create a fresh one on first run.
)

echo.
echo ============================================
echo  BUILD SUCCESSFUL!
echo ============================================
echo.
echo  Your app is ready at:
echo  dist\FinanceTracker\FinanceTracker.exe
echo.
echo  To install: copy the entire dist\FinanceTracker
echo  folder anywhere you like and double-click
echo  FinanceTracker.exe to launch.
echo.
echo  Your data (finance.db) stays in the same
echo  folder as the .exe — back it up regularly.
echo.
pause
