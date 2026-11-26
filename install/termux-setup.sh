#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  Instalação da NARA no Termux (Samsung S23 Ultra)
#  Rode dentro da pasta do projeto:  bash install/termux-setup.sh
# ============================================================
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Pasta do projeto: $DIR"

echo "==> Atualizando o Termux e instalando programas (pode demorar ~5 min)…"
yes | pkg update -y || true
pkg install -y nodejs-lts ffmpeg git curl termux-api termux-tools python

echo "==> Instalando o SDK da Claude (motor)…"
(cd "$DIR/server" && npm install --omit=dev --no-audit --no-fund)

echo "==> Instalando a voz grátis da Nara (Edge TTS)…"
# instala em modo "puro Python" (não precisa compilar nada no celular)
export AIOHTTP_NO_EXTENSIONS=1 MULTIDICT_NO_EXTENSIONS=1 YARL_NO_EXTENSIONS=1 FROZENLIST_NO_EXTENSIONS=1 PROPCACHE_NO_EXTENSIONS=1
pip install --upgrade edge-tts || echo "   (não consegui instalar a voz Edge — a Nara usa a voz reserva)"

echo "==> Baixando fontes das legendas…"
FONTS="$DIR/server/data/fonts"
mkdir -p "$FONTS" "$DIR/server/data/music"
B=https://raw.githubusercontent.com/google/fonts/main
dl() { [ -s "$FONTS/$2" ] || curl -fsSL -o "$FONTS/$2" "$B/$1" || echo "   (falhou $2 — tudo bem)"; }
dl ofl/anton/Anton-Regular.ttf Anton-Regular.ttf
dl ofl/bebasneue/BebasNeue-Regular.ttf BebasNeue-Regular.ttf
dl ofl/poppins/Poppins-Bold.ttf Poppins-Bold.ttf
dl ofl/poppins/Poppins-Regular.ttf Poppins-Regular.ttf
dl "ofl/montserrat/Montserrat%5Bwght%5D.ttf" Montserrat.ttf
dl "ofl/roboto/Roboto%5Bwdth,wght%5D.ttf" Roboto.ttf

echo "==> Configurando para ligar sozinha quando o celular reiniciar (Termux:Boot)…"
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/start-nara.sh <<BOOT
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd "$DIR"
nohup sh install/run-nara.sh > "$HOME/nara.out" 2>&1 &
BOOT
chmod +x ~/.termux/boot/start-nara.sh install/run-nara.sh

echo "==> Criando atalhos: nara-start, nara-stop, nara-log, nara-update"
for f in ~/.bashrc; do
  grep -q "# NARA" "$f" 2>/dev/null || cat >> "$f" <<ALIAS
# NARA
alias nara-start='sh ~/.termux/boot/start-nara.sh; sleep 3; tail -n 15 ~/nara.out'
alias nara-stop='pkill -f run-nara.sh; pkill -f "node src/index.js"; echo Nara parada'
alias nara-log='tail -n 60 -f ~/nara.out'
alias nara-update='cd "$DIR" && git pull && nara-stop; nara-start'
ALIAS
done

echo "==> Ligando a Nara agora…"
pkill -f run-nara.sh 2>/dev/null || true
pkill -f "node src/index.js" 2>/dev/null || true
sh ~/.termux/boot/start-nara.sh
sleep 4
tail -n 12 "$HOME/nara.out" || true
echo
echo "============================================================"
echo " PRONTO! Abra no navegador do celular (DeX):  http://localhost:8080"
echo " A senha da página aparece acima ('Senha da página')."
echo " Feche e abra o Termux para os atalhos nara-log / nara-start funcionarem."
echo "============================================================"
