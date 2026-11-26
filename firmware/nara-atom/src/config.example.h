// 1) Copie este arquivo para "config.h" (na mesma pasta)
// 2) Preencha com seus dados
#pragma once

#define WIFI_SSID      "NOME_DO_SEU_WIFI"
#define WIFI_PASSWORD  "SENHA_DO_WIFI"

// Endereço do celular na rede (aparece na página da Nara, aba Sistema)
// Ex.: "http://192.168.0.15:8080"
#define NARA_SERVER    "http://192.168.0.15:8080"

// Token do Atom S3R (página da Nara → Chaves e ajustes → Token do Atom S3R)
#define NARA_TOKEN     "cole_o_token_aqui"

// true = está encaixado na base de voz (Atomic Echo Base / Voice Base do kit AI Chatbot)
#define HAS_VOICE_BASE true

// Escuta contínua: quando ouvir som, grava e manda para a Nara (que só reage se ouvir "Nara").
// Gasta mais cota do Google. false = só escuta quando você apertar o botão.
#define ALWAYS_LISTEN  true

// Sensibilidade da escuta contínua (maior = precisa falar mais alto)
#define VOICE_THRESHOLD 1800
