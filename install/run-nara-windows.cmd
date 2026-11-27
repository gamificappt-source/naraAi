@echo off
rem Mantem a Nara rodando para sempre no Windows: se cair, reinicia em 5 segundos.
rem (Iniciado escondido pelo atalho Nara.vbs na pasta Inicializar do Windows.)
cd /d "%~dp0..\server"
:loop
node src\index.js >> "%~dp0..\server\data\console.log" 2>&1
timeout /t 5 /nobreak >nul
goto loop
