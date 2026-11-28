// =============================================================
//  NARA — firmware para M5Stack AtomS3R / AtomS3R-CAM
//  - Aperte o botão: a Nara ouve seu pedido (se tiver base de voz)
//    ou dá o briefing do dia (sem base de voz).
//  - Segure o botão 1s: briefing do dia ("Nara, bom dia").
//  - Escuta contínua (opcional): fale "Nara, bom dia" / "Nara, posta um vídeo extra…"
//  - Primeira vez (ou botão apertado ao ligar): cria a rede Wi-Fi "Nara-Setup"
//    para você digitar Wi-Fi, endereço da Nara e token (pelo celular ou PC).
//  A voz da resposta sai pelas caixas de som do PC e/ou pelo alto-falante da base.
// =============================================================
#include <M5Unified.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>
#if __has_include("config.h")
#include "config.h"
#endif
#ifndef WIFI_SSID
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#define NARA_SERVER ""
#define NARA_TOKEN ""
#endif
#ifndef HAS_VOICE_BASE
#define HAS_VOICE_BASE true
#endif
#ifndef ALWAYS_LISTEN
#define ALWAYS_LISTEN false
#endif
#ifndef VOICE_THRESHOLD
#define VOICE_THRESHOLD 120  // mínimo; a sensibilidade real é automática (2x o barulho de fundo)
#endif

// Configuração salva no Atom (preenchida pela rede "Nara-Setup")
struct Cfg { String ssid, pass, server, token; bool voiceBase, listen; int threshold; } cfg;
Preferences prefs;

void loadCfg() {
  prefs.begin("nara", true);
  cfg.ssid = prefs.getString("ssid", WIFI_SSID);
  cfg.pass = prefs.getString("pass", WIFI_PASSWORD);
  cfg.server = prefs.getString("server", NARA_SERVER);
  cfg.token = prefs.getString("token", NARA_TOKEN);
  cfg.voiceBase = prefs.getBool("voice", HAS_VOICE_BASE);
  cfg.listen = prefs.getBool("listen", ALWAYS_LISTEN);
  cfg.threshold = prefs.getInt("thr", VOICE_THRESHOLD);
  prefs.end();
  cfg.ssid.trim();
  cfg.server.trim();
  cfg.token.trim();
  while (cfg.server.endsWith("/")) cfg.server.remove(cfg.server.length() - 1);
  if (cfg.server.length() && !cfg.server.startsWith("http")) cfg.server = "http://" + cfg.server;
}

static const uint32_t MIC_RATE = 16000;
static const size_t CHUNK = 1600;            // 100 ms
static const size_t MAX_SECONDS = 6;
static int16_t *recBuf = nullptr;            // PSRAM
static size_t recLen = 0;
static bool micOk = false;
static bool hasDisplay = false;
static float noiseFloor = 80;                // barulho de fundo medido sem parar (sensibilidade automática)
static const int PRE = 5;                    // pedaços guardados antes do disparo (~0,5 s)
static int preIdx = 0;
int level(const int16_t *s, size_t n);

// ---------- configuração e diagnóstico pelo cabo USB ----------
//  SHOW                       → mostra a configuração e a conexão
//  SET chave=valor            → ssid, pass, server, token, voice (0/1), listen (0/1), thr
//  TEST                       → testa a conversa com a Nara
//  RESTART                    → reinicia
int pingNara() {
  if (WiFi.status() != WL_CONNECTED || cfg.server.isEmpty()) return -100;
  HTTPClient http;
  http.begin(cfg.server + "/api/device/status");
  http.addHeader("x-nara-token", cfg.token);
  http.setTimeout(8000);
  int code = http.GET();
  http.end();
  return code;
}

void printCfg() {
  Serial.println("=== NARA ATOM ===");
  Serial.printf("ssid=%s\n", cfg.ssid.c_str());
  Serial.printf("pass=%d caracteres\n", cfg.pass.length());
  Serial.printf("server=%s\n", cfg.server.c_str());
  Serial.printf("token=%s\n", cfg.token.c_str());
  Serial.printf("voice=%d listen=%d thr=%d\n", cfg.voiceBase, cfg.listen, cfg.threshold);
  Serial.printf("wifi=%s ip=%s rssi=%d\n", WiFi.status() == WL_CONNECTED ? "conectado" : "desconectado", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  Serial.println("=================");
}

void handleSerial() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.isEmpty()) return;
  if (line.equalsIgnoreCase("SHOW")) { printCfg(); return; }
  if (line.equalsIgnoreCase("RESTART")) { Serial.println("OK reiniciando"); delay(300); ESP.restart(); }
  if (line.equalsIgnoreCase("TEST")) { Serial.printf("TEST Nara respondeu: %d\n", pingNara()); return; }
  if (line.equalsIgnoreCase("MIC")) {  // medidor: 8 s de níveis do microfone (para ajustar a sensibilidade)
    if (!micOk) { Serial.println("MIC microfone desligado"); return; }
    for (int i = 0; i < 80; i++) {
      M5.Mic.record(recBuf, CHUNK, MIC_RATE);
      while (M5.Mic.isRecording()) delay(1);
      int pk = 0;
      for (size_t j = 0; j < CHUNK; j++) pk = max(pk, abs((int)recBuf[j]));
      Serial.printf("MIC nivel=%d pico=%d\n", level(recBuf, CHUNK), pk);
    }
    Serial.println("MIC fim");
    return;
  }
  if (line.startsWith("SET ") || line.startsWith("set ")) {
    String kv = line.substring(4);
    int eq = kv.indexOf('=');
    if (eq < 1) { Serial.println("ERRO use SET chave=valor"); return; }
    String k = kv.substring(0, eq), v = kv.substring(eq + 1);
    k.trim();
    prefs.begin("nara", false);
    if (k == "ssid") prefs.putString("ssid", v);
    else if (k == "pass") prefs.putString("pass", v);
    else if (k == "server") prefs.putString("server", v);
    else if (k == "token") prefs.putString("token", v);
    else if (k == "voice") prefs.putBool("voice", v.toInt() != 0);
    else if (k == "listen") prefs.putBool("listen", v.toInt() != 0);
    else if (k == "thr") prefs.putInt("thr", v.toInt() > 0 ? v.toInt() : 120);
    else { prefs.end(); Serial.println("ERRO chave desconhecida"); return; }
    prefs.end();
    loadCfg();
    Serial.printf("OK %s salvo\n", k.c_str());
    return;
  }
  Serial.println("ERRO comando desconhecido (SHOW, SET chave=valor, TEST, RESTART)");
}


// ---------- feedback visual ----------
void showStatus(const char *txt, uint16_t color) {
  Serial.println(txt);
  if (!hasDisplay) return;
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.fillCircle(M5.Display.width() / 2, 40, 22, color);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.setTextDatum(middle_center);
  M5.Display.drawString("NARA", M5.Display.width() / 2, 40);
  M5.Display.drawString(txt, M5.Display.width() / 2, 95);
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  showStatus("WiFi...", TFT_YELLOW);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(cfg.ssid.c_str(), cfg.pass.c_str());
  for (int i = 0; i < 60 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  showStatus(WiFi.status() == WL_CONNECTED ? "pronta" : "sem WiFi", WiFi.status() == WL_CONNECTED ? TFT_GREEN : TFT_RED);
}

// ---------- áudio ----------
void writeWavHeader(uint8_t *h, uint32_t dataBytes) {
  auto w32 = [&](int o, uint32_t v) { memcpy(h + o, &v, 4); };
  auto w16 = [&](int o, uint16_t v) { memcpy(h + o, &v, 2); };
  memcpy(h, "RIFF", 4); w32(4, 36 + dataBytes); memcpy(h + 8, "WAVE", 4);
  memcpy(h + 12, "fmt ", 4); w32(16, 16); w16(20, 1); w16(22, 1);
  w32(24, MIC_RATE); w32(28, MIC_RATE * 2); w16(32, 2); w16(34, 16);
  memcpy(h + 36, "data", 4); w32(40, dataBytes);
}

int level(const int16_t *s, size_t n) {
  uint32_t acc = 0;
  for (size_t i = 0; i < n; i++) acc += abs(s[i]);
  return acc / n;
}

void micOn() {
  if (!micOk) return;
  M5.Speaker.end();
  M5.Mic.begin();
}

// grava até "seconds" segundos, parando após ~1,2 s de silêncio
void recordUtterance(size_t startOffset, float seconds) {
  recLen = startOffset;
  size_t maxLen = min((size_t)(seconds * MIC_RATE), MAX_SECONDS * MIC_RATE);
  int quiet = 0;
  while (recLen + CHUNK <= maxLen) {
    M5.Mic.record(recBuf + recLen, CHUNK, MIC_RATE);
    while (M5.Mic.isRecording()) delay(1);
    int lv = level(recBuf + recLen, CHUNK);
    recLen += CHUNK;
    // silêncio = perto do barulho de fundo do ambiente
    quiet = lv < max((int)(noiseFloor * 1.6f), 40) ? quiet + 1 : 0;
    if (quiet > 12 && recLen > MIC_RATE * 1.5) break;
  }
}

void playReplyAudio() {
  if (!cfg.voiceBase) return;
  HTTPClient http;
  http.begin(cfg.server + "/api/device/audio");
  http.addHeader("x-nara-token", cfg.token);
  http.setTimeout(30000);
  int code = http.GET();
  if (code == 200) {
    int size = http.getSize();
    if (size > 0 && size < 4 * 1024 * 1024) {
      uint8_t *buf = (uint8_t *)ps_malloc(size);
      if (buf) {
        WiFiClient *st = http.getStreamPtr();
        int got = 0;
        uint32_t t0 = millis();
        while (got < size && millis() - t0 < 30000) {
          int n = st->readBytes(buf + got, size - got);
          if (n <= 0) delay(5); else got += n;
        }
        M5.Mic.end();
        M5.Speaker.begin();
        M5.Speaker.setVolume(200);
        M5.Speaker.playRaw((const int16_t *)buf, got / 2, 24000, false, 1, 0);
        while (M5.Speaker.isPlaying()) { delay(20); M5.update(); }
        free(buf);
      }
    }
  }
  http.end();
  micOn();
}

// ---------- conversa com o servidor ----------
void handleResponse(const String &body) {
  JsonDocument doc;
  if (deserializeJson(doc, body)) return;
  const char *heard = doc["heard"] | "";
  const char *reply = doc["reply"] | "";
  if (strlen(heard)) Serial.printf("Ouvi: %s\n", heard);
  if (strlen(reply)) Serial.printf("Nara: %s\n", reply);
  if (doc["audio"] | false) playReplyAudio();
}

void sendVoice(bool requireWake) {
  connectWiFi();
  showStatus("pensando", TFT_BLUE);
  size_t bytes = recLen * 2;
  uint8_t *wav = (uint8_t *)ps_malloc(44 + bytes);
  if (!wav) return;
  writeWavHeader(wav, bytes);
  memcpy(wav + 44, recBuf, bytes);
  HTTPClient http;
  http.begin(cfg.server + "/api/device/voice?wake=" + (requireWake ? "1" : "0"));
  http.addHeader("Content-Type", "audio/wav");
  http.addHeader("x-nara-token", cfg.token);
  http.setTimeout(90000);
  int code = http.POST(wav, 44 + bytes);
  free(wav);
  String body = code > 0 ? http.getString() : "";
  http.end();
  if (code == 200) handleResponse(body);
  else Serial.printf("Erro HTTP %d\n", code);
  showStatus("pronta", TFT_GREEN);
}

void wakeBriefing() {
  connectWiFi();
  showStatus("bom dia!", TFT_ORANGE);
  HTTPClient http;
  http.begin(cfg.server + "/api/device/wake");
  http.addHeader("x-nara-token", cfg.token);
  http.setTimeout(90000);
  int code = http.POST("");
  String body = code > 0 ? http.getString() : "";
  http.end();
  if (code == 200) handleResponse(body);
  else Serial.printf("Erro HTTP %d\n", code);
  showStatus("pronta", TFT_GREEN);
}

// ---------- modo configuração (rede Wi-Fi "Nara-Setup") ----------
String esc(const String &v) { String o = v; o.replace("\"", "&quot;"); o.replace("<", "&lt;"); return o; }

void runSetupPortal() {
  WebServer web(80);
  DNSServer dns;
  WiFi.mode(WIFI_AP);
  WiFi.softAP("Nara-Setup");
  dns.start(53, "*", WiFi.softAPIP());
  showStatus("Nara-Setup", TFT_MAGENTA);
  Serial.println("Modo configuracao: conecte na rede Wi-Fi 'Nara-Setup' e abra http://192.168.4.1");
  auto page = [&]() {
    String h = F("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
      "<title>Nara Setup</title><style>body{font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:16px;max-width:460px;margin:auto}"
      "input{width:100%;padding:10px;margin:4px 0 12px;border-radius:8px;border:1px solid #2a3240;background:#161b22;color:#e6edf3;box-sizing:border-box}"
      "button{background:#7ee0c3;border:0;padding:12px;border-radius:8px;width:100%;font-weight:bold}label{font-size:14px;color:#8b98a9}</style>"
      "<h2>Configurar a Nara</h2><form method=post action=/save>");
    h += "<label>Nome do Wi-Fi (2,4 GHz)</label><input name=ssid value=\"" + esc(cfg.ssid) + "\">";
    h += "<label>Senha do Wi-Fi</label><input name=pass type=password value=\"" + esc(cfg.pass) + "\">";
    h += "<label>Endereço da Nara (aba Sistema da página). Ex.: http://192.168.0.15:8080</label><input name=server value=\"" + esc(cfg.server) + "\">";
    h += "<label>Token do Atom S3R (página → Chaves e ajustes)</label><input name=token value=\"" + esc(cfg.token) + "\">";
    h += String("<label><input type=checkbox name=voice style='width:auto' ") + (cfg.voiceBase ? "checked" : "") + "> Tenho a base de voz (microfone + alto-falante)</label><br><br>";
    h += String("<label><input type=checkbox name=listen style='width:auto' ") + (cfg.listen ? "checked" : "") + "> Escuta contínua (\"Nara, ...\" sem apertar o botão — precisa da chave Groq)</label><br><br>";
    h += "<label>Sensibilidade (maior = precisa falar mais alto)</label><input name=thr type=number value=" + String(cfg.threshold) + ">";
    h += F("<button>Salvar e reiniciar</button></form>");
    web.send(200, "text/html", h);
  };
  web.on("/", page);
  web.onNotFound(page);
  web.on("/save", HTTP_POST, [&]() {
    prefs.begin("nara", false);
    prefs.putString("ssid", web.arg("ssid"));
    prefs.putString("pass", web.arg("pass"));
    prefs.putString("server", web.arg("server"));
    prefs.putString("token", web.arg("token"));
    prefs.putBool("voice", web.hasArg("voice"));
    prefs.putBool("listen", web.hasArg("listen"));
    prefs.putInt("thr", web.arg("thr").toInt() > 0 ? web.arg("thr").toInt() : 120);
    prefs.end();
    web.send(200, "text/html", "<meta charset=utf-8><body style='font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:20px'><h2>Salvo! ✅</h2><p>A Nara vai reiniciar e entrar no seu Wi-Fi.</p>");
    delay(1500);
    ESP.restart();
  });
  web.begin();
  for (;;) { dns.processNextRequest(); web.handleClient(); M5.update(); handleSerial(); delay(2); }
}

// ---------- programa ----------
void setup() {
  loadCfg();  // lê a configuração salva (não precisa do hardware iniciado)
  auto mc = M5.config();
  if (cfg.voiceBase) mc.external_speaker.atomic_echo = true;  // base de voz (ES8311: microfone + alto-falante)
  M5.begin(mc);
  Serial.begin(115200);
  Serial.setTimeout(200);
  delay(300);
  hasDisplay = M5.Display.width() > 0 && M5.Display.height() > 0;
  if (hasDisplay) M5.Display.setTextSize(1.5);

  // Sem configuração, ou botão apertado ao ligar → modo configuração
  M5.update();
  if (cfg.ssid.isEmpty() || cfg.server.isEmpty() || M5.BtnA.isPressed()) runSetupPortal();

  recBuf = (int16_t *)ps_malloc(MAX_SECONDS * MIC_RATE * sizeof(int16_t));
  micOk = cfg.voiceBase && recBuf && M5.Mic.isEnabled();
  micOn();
  connectWiFi();
  // não conectou no Wi-Fi em 30s → abre o modo configuração para corrigir
  if (WiFi.status() != WL_CONNECTED) runSetupPortal();
  Serial.printf("Nara pronta. Microfone: %s\n", micOk ? "sim" : "nao (modo botao)");
  printCfg();
  Serial.printf("Nara respondeu: %d\n", pingNara());  // avisa a Nara que ligou (aparece em "Último contato")
}

static uint32_t lastPing = 0;

void loop() {
  M5.update();
  handleSerial();
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  // a cada 60 s avisa a Nara que está vivo
  if (millis() - lastPing > 60000) {
    lastPing = millis();
    int c = pingNara();
    if (c != 200) Serial.printf("Nara respondeu: %d\n", c);
  }

  // segurar 1s = briefing
  if (M5.BtnA.wasHold()) { wakeBriefing(); return; }
  // clique = ouvir pedido (ou briefing se não tiver microfone)
  if (M5.BtnA.wasClicked()) {
    if (micOk) {
      showStatus("ouvindo", TFT_RED);
      recordUtterance(0, 6);
      sendVoice(false);
    } else {
      wakeBriefing();
    }
    return;
  }

  if (cfg.listen && micOk) {
    // grava em "anel": guarda sempre os últimos PRE pedaços (~0,5 s) para não cortar o começo ("Na-ra")
    int16_t *slot = recBuf + (preIdx % PRE) * CHUNK;
    M5.Mic.record(slot, CHUNK, MIC_RATE);
    while (M5.Mic.isRecording()) delay(1);
    int lv = level(slot, CHUNK);
    preIdx++;
    // dispara quando a voz fica bem acima do barulho de fundo (e acima do mínimo "thr")
    int trigger = max(cfg.threshold, (int)(noiseFloor * 2.0f));
    if (lv > trigger) {
      Serial.printf("ouvindo (nivel %d, fundo %d)\n", lv, (int)noiseFloor);
      showStatus("ouvindo", TFT_RED);
      // coloca o áudio guardado em ordem (do mais antigo ao atual) no começo da gravação
      int n = min(preIdx, PRE);
      static int16_t tmp[PRE * CHUNK];
      for (int i = 0; i < n; i++) memcpy(tmp + i * CHUNK, recBuf + ((preIdx - n + i) % PRE) * CHUNK, CHUNK * 2);
      memcpy(recBuf, tmp, n * CHUNK * 2);
      preIdx = 0;
      recordUtterance(n * CHUNK, 5.5);
      sendVoice(true);  // só reage se ouvir a palavra "Nara"
    } else {
      noiseFloor = noiseFloor * 0.97f + lv * 0.03f;  // aprende o barulho do ambiente
    }
  }
  delay(5);
}
