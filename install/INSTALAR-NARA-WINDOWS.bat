<# : bloco do Windows (CMD) - nao mexa nestas linhas
@echo off
chcp 65001 >nul
set "NARA_BAT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8))"
echo.
pause
exit /b
#>
# =====================================================================
#  Instalador da NARA para Windows  (de dois cliques neste arquivo)
#  Instala: Git, GitHub CLI, Node.js, ffmpeg, Python + voz gratis,
#  baixa o projeto em C:\NARA\naraAi, liga a Nara e deixa ela
#  iniciando sozinha junto com o Windows.
# =====================================================================
$ErrorActionPreference = 'Continue'  # git/gh escrevem avisos normais que nao sao erros
$Base   = 'C:\NARA'
$Dir    = Join-Path $Base 'naraAi'
$Repo   = 'gamificappt-source/naraAi'
$Branch = 'claude/nara-content-automation-vuhcas'

function Passo($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }

# --- precisa ser administrador (firewall e energia) ---
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host "Pedindo permissao de administrador... clique SIM na janela que aparecer." -ForegroundColor Yellow
  Start-Process -FilePath $env:NARA_BAT -Verb RunAs
  exit
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "O 'winget' nao foi encontrado. Abra a Microsoft Store, atualize o 'Instalador de Aplicativo' e rode de novo." -ForegroundColor Red
  exit
}

Passo "Instalando programas (pode demorar alguns minutos)..."
$pkgs = @('Git.Git', 'GitHub.cli', 'OpenJS.NodeJS.LTS', 'Gyan.FFmpeg', 'Python.Python.3.12')
foreach ($p in $pkgs) {
  Write-Host "   - $p"
  winget install --id $p -e --silent --accept-source-agreements --accept-package-agreements | Out-Null
}
RefreshPath
# o ffmpeg do winget fica numa pasta propria: garante que esta no PATH
$ff = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ff -and -not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  $bin = $ff.DirectoryName
  [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ";$bin", 'User')
  RefreshPath
}
# Python as vezes nao entra no PATH sozinho
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  $py = Get-ChildItem "$env:LOCALAPPDATA\Programs\Python" -Recurse -Filter python.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($py) {
    [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ";$($py.DirectoryName);$($py.DirectoryName)\Scripts", 'User')
    RefreshPath
  }
}
foreach ($c in 'git','gh','node','npm','ffmpeg','python') {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Write-Host "Nao encontrei '$c'. Feche esta janela e rode o instalador de novo." -ForegroundColor Red; exit }
}

Passo "Login no GitHub (o projeto e privado)"
cmd /c "gh auth status >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Vai abrir o navegador. Copie o codigo que aparecer aqui, cole no site e clique Authorize." -ForegroundColor Yellow
  gh auth login --hostname github.com --git-protocol https --web
  gh auth setup-git
}

Passo "Baixando a Nara em $Dir"
New-Item -ItemType Directory -Force -Path $Base | Out-Null
if (Test-Path (Join-Path $Dir '.git')) {
  git -C $Dir fetch origin $Branch; git -C $Dir checkout $Branch; git -C $Dir pull
} else {
  gh repo clone $Repo $Dir
  git -C $Dir checkout $Branch
}

Passo "Instalando o SDK da Claude (motor)"
Push-Location (Join-Path $Dir 'server'); npm install --omit=dev --no-audit --no-fund; Pop-Location

Passo "Instalando a voz gratis da Nara (Edge TTS)"
python -m pip install --upgrade edge-tts
RefreshPath
$scripts = python -c "import sysconfig;print(sysconfig.get_path('scripts'))"
if ($scripts -and -not (Get-Command edge-tts -ErrorAction SilentlyContinue)) {
  [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ";$scripts", 'User')
  RefreshPath
}

Passo "Baixando fontes das legendas"
$fonts = Join-Path $Dir 'server\data\fonts'
New-Item -ItemType Directory -Force -Path $fonts, (Join-Path $Dir 'server\data\music') | Out-Null
$B = 'https://raw.githubusercontent.com/google/fonts/main'
$lista = @{
  'Anton-Regular.ttf' = 'ofl/anton/Anton-Regular.ttf'; 'BebasNeue-Regular.ttf' = 'ofl/bebasneue/BebasNeue-Regular.ttf'
  'Poppins-Bold.ttf' = 'ofl/poppins/Poppins-Bold.ttf'; 'Poppins-Regular.ttf' = 'ofl/poppins/Poppins-Regular.ttf'
  'Montserrat.ttf' = 'ofl/montserrat/Montserrat%5Bwght%5D.ttf'; 'Roboto.ttf' = 'ofl/roboto/Roboto%5Bwdth,wght%5D.ttf'
}
foreach ($k in $lista.Keys) {
  $dest = Join-Path $fonts $k
  if (-not (Test-Path $dest)) { try { Invoke-WebRequest "$B/$($lista[$k])" -OutFile $dest -UseBasicParsing } catch { Write-Host "   (falhou $k - tudo bem)" } }
}

Passo "Deixando o PC sempre ligado (sem suspender na tomada)"
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

Passo "Liberando a porta 8080 no firewall (para o Atom S3R e o celular acessarem)"
if (-not (Get-NetFirewallRule -DisplayName 'Nara 8080' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Nara 8080' -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow -Profile Any | Out-Null
}

Passo "Configurando para ligar sozinha com o Windows"
$cmd = Join-Path $Dir 'install\run-nara-windows.cmd'
$startup = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $startup 'Nara.vbs'
Set-Content -Path $vbs -Encoding ASCII -Value "CreateObject(""WScript.Shell"").Run """"""$cmd"""""", 0, False"

Passo "Ligando a Nara..."
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*src/index.js*' -or $_.CommandLine -like '*src\index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process wscript.exe -ArgumentList "`"$vbs`""
Start-Sleep -Seconds 6
$cfg = Join-Path $Dir 'server\data\config.json'
$senha = ''
for ($i = 0; $i -lt 10 -and -not $senha; $i++) { if (Test-Path $cfg) { $senha = (Get-Content $cfg -Raw | ConvertFrom-Json).settings.adminToken }; if (-not $senha) { Start-Sleep 2 } }
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host " PRONTO! A Nara esta rodando." -ForegroundColor Green
Write-Host "  Neste PC:            http://localhost:8080"
Write-Host "  Celular / Atom S3R:  http://$($ip):8080"
Write-Host "  SENHA DA PAGINA:     $senha" -ForegroundColor Yellow
Write-Host "  (Ela liga sozinha sempre que o Windows iniciar.)"
Write-Host "=============================================================" -ForegroundColor Green
Start-Process "http://localhost:8080"
