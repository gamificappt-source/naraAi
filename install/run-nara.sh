#!/data/data/com.termux/files/usr/bin/sh
# Mantém a Nara rodando para sempre: se cair, reinicia em 5 segundos.
cd "$(dirname "$0")/../server" || exit 1
while true; do
  node src/index.js
  echo "[run-nara] Nara parou (código $?). Reiniciando em 5s…"
  sleep 5
done
