@echo off
chcp 65001 > nul
title Balance & Precios - Gestor de Importación
cd /d "%~dp0"

echo ========================================================
echo   ⚖️ BALANCE & PRECIOS - GESTOR DE ARTÍCULOS
echo ========================================================
echo.
echo Iniciando el servidor local y abriendo tu navegador...
echo.

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    python servidor.py
) else (
    echo [AVISO] Python no encontrado en PATH. Abriendo directamente en el navegador...
    start "" index.html
    pause
)
