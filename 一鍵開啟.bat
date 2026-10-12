@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 我們的小金庫

where node >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js。
  echo 請到 https://nodejs.org 下載並安裝 LTS 版本（20 以上），安裝後重新執行此檔案。
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo [錯誤] Node.js 版本過舊，需要 20 以上。目前版本：
  node -v
  pause
  exit /b 1
)

if not exist "node_modules\.package-lock.json" (
  echo 第一次啟動或套件不完整，正在安裝套件（npm install）...
  call npm install
  if errorlevel 1 (
    echo [錯誤] npm install 失敗，請檢查網路連線後再試一次。
    pause
    exit /b 1
  )
)

echo.
echo 啟動中，瀏覽器會自動開啟。關閉這個視窗即可停止。
echo 資料只存在瀏覽器的 IndexedDB，請記得定期在「系統設定」匯出備份。
echo.
call npx vite --open
pause
