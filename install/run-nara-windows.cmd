@echo off
rem Mantem a Nara rodando para sempre no Windows: se cair, reinicia em 5 segundos.
rem (Iniciado escondido pelo atalho Nara.vbs na pasta Inicializar do Windows.)
rem Recarrega o PATH do registro (node, ffmpeg, edge-tts instalados depois que o processo pai abriu).
for /f "tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul ^| find /i "Path"') do set "MPATH=%%B"
for /f "tokens=2,*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul ^| find /i "Path"') do set "UPATH=%%B"
call set "PATH=%MPATH%;%UPATH%;%ProgramFiles%\nodejs"
cd /d "%~dp0..\server"
if not exist data mkdir data
:loop
echo [%date% %time%] iniciando a Nara >> "data\console.log"
node src\index.js >> "data\console.log" 2>&1
timeout /t 5 /nobreak >nul
goto loop
