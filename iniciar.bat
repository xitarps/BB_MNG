@echo off
setlocal
cd /d "%~dp0"
title Crizsopha
echo.
echo  Crizsopha - consulta Bitbucket
echo  Abra http://127.0.0.1:8765
echo  Mantenha esta janela aberta. Feche para encerrar.
echo.
where py >nul 2>&1 && (
  py -3 server\proxy.py
  goto :eof
)
where python >nul 2>&1 && (
  python server\proxy.py
  goto :eof
)
where python3 >nul 2>&1 && (
  python3 server\proxy.py
  goto :eof
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\proxy.ps1"
