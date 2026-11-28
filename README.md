# 🤖 NARA — sua assistente que cria e posta conteúdo sozinha

A Nara roda **24 horas num PC Windows** (pode deixar a página fechada) e faz sozinha o que você faria à mão:
escolhe o tema, escreve o roteiro, narra, monta o vídeo ou carrossel e posta no **YouTube** e no **Instagram**, em vários perfis.
Você conversa com ela pela página ou pelo **Atom S3R** ("Nara, bom dia").

| Papel | Quem | Para quê | Custo |
|---|---|---|---|
| 🧠 **Cérebro** | DeepSeek | Conversa, briefing, entender seus pedidos e mudar as configurações | centavos |
| ⚙️ **Motor** | Claude (sua assinatura Pro/Max neste PC, ou chave de API) | Temas (com pesquisa de atualidades), roteiros, carrosséis, imagem de referência | incluso na assinatura |
| 🎙️ **Narração** | Google AI Studio (até 5 chaves em rodízio) | A voz que narra os vídeos | grátis (com limite diário) |
| 🗣️ **Voz da Nara** | Edge TTS | Ela falando com você nas caixas de som / no Atom | grátis |
| 👂 **Ouvido** | Groq | Entender o que você fala no Atom S3R | grátis |

```
Tema (sua fila, ou a Claude pesquisa: notícias de hoje + o que deu mais engajamento)
  → Claude escreve o roteiro seguindo o PROMPT PADRÃO do perfil
  → Google narra com a voz e o tom do perfil
  → imagens (internet / IA no estilo da sua referência)
  → ffmpeg monta (zoom, legendas com palavra em destaque, música, logo no final)
  → posta no YouTube e/ou Instagram, conforme as regras do perfil
  → coleta views/curtidas → os próximos temas seguem o que engajou mais
```

---

## 1. Instalar (uma vez)

1. No GitHub, abra **`install/INSTALAR-NARA-WINDOWS.bat`** → **Download raw file**.
2. Dois cliques no arquivo → se aparecer "O Windows protegeu o computador": **Mais informações → Executar assim mesmo** → **Sim**.
3. Ele instala tudo (Git, Node.js, ffmpeg, Python, voz grátis), baixa a Nara em `C:\NARA\naraAi`, libera a porta 8080 no firewall,
   impede o PC de suspender na tomada e deixa a Nara **ligando sozinha com o Windows** (e reiniciando se cair).
4. No final aparece a **SENHA DA PÁGINA** e abre **http://localhost:8080**.

Para atualizar depois: rode o mesmo arquivo de novo.

### Claude pela assinatura (sem chave de API)
A Nara usa o **Claude Code** instalado neste PC (vem junto com o app Claude). Faça o login **uma vez** num terminal:
```
claude auth login
```
Cada vídeo é uma conversa **nova e descartável** (não acumula nada e não trava). Os limites de uso da assinatura valem normalmente.

---

## 2. A página

- **Painel**: números do dia, crescimento, agenda, produções (aprovar / ver / tentar de novo) e conversa com a Nara.
- **Perfis**: biblioteca com as capas. Clique num perfil para configurar:
  - **Identidade** — nome, nicho, público, tom, fila de temas, **capa** e **logo** (chamada final dos vídeos).
  - **Vídeo** — **prompt padrão** (a IA só muda o assunto), duração em minutos, formato, estilo visual (texto livre), **referência de layout** e a **fonte das legendas** (cores, tamanho e posição são automáticos).
  - **Voz** — as 30 vozes do Google, **tom** da voz e botão **Ouvir amostra**.
  - **Carrossel** — prompt padrão, referência própria, **fonte dos títulos + fonte do texto**, slides, legenda, hashtags.
  - **Frequência** — vídeos/carrosséis/imagens por dia, dias da semana, horários, postar sozinha, seguir o engajamento.
  - **Publicação** — regras do **YouTube** e do **Instagram** (o mesmo perfil pode postar nos dois).
  - No topo: **mini dashboard** (seguidores, crescimento 7/30 dias, média de views, melhores assuntos).
- **Agenda**: tudo o que está agendado e o histórico.
- **Nara**: conversa, voz dela, briefing automático e dados do Atom S3R.
- **Ajustes**: chaves (DeepSeek, Claude opcional, **5 chaves do Google**, Groq), app do YouTube, **fontes**, sistema e registro.

**Fontes:** em fonts.google.com escolha a fonte → **Get font → Get embed code** → copie o `<link …>` e cole em **Adicionar fontes**
(no perfil, aba Vídeo, ou em Ajustes). A Nara baixa todas as variações (pesos) do código e elas aparecem para escolher em todos os perfis.

**Temas sem repetir (e gastando menos):** a Claude pesquisa um **lote de ~12 temas** de uma vez, em categorias diferentes, e guarda no
**banco de temas** do perfil. Cada vídeo pega o próximo, sem repetir a mesma categoria seguida. Tudo que já foi usado fica num **histórico
permanente** (`server\data\topics\`) e temas parecidos são barrados. Quando o banco acaba, ela pesquisa outro lote.

**Pastas de referências:** cada perfil tem `C:\NARA\Referencias\<Perfil>\Video` e `\Carrossel`. Coloque várias imagens de estilos que você gosta
(copiando para a pasta ou arrastando na página). A cada post a Nara usa **uma diferente** (a que está há mais tempo sem uso), e cada imagem é
analisada pela Claude **uma vez só**.

> Tudo também pode ser mudado **conversando** com a Nara: "muda o perfil X para 3 vídeos por dia de 2 minutos, só de segunda a sexta", "troca a voz do perfil Y para Charon", "cria um perfil chamado Z sobre história do Brasil".

---

## 3. Conectar o YouTube (uma vez, serve para todos os canais)

1. **console.cloud.google.com** → crie o projeto **Nara**.
2. **APIs e serviços → Biblioteca** → **YouTube Data API v3** → **Ativar**.
3. **Tela de consentimento OAuth** → Externo, nome "Nara", seu e-mail → **Público-alvo → Publicar app** (se ficar em "Teste", o login expira em 7 dias).
4. **Credenciais → Criar credenciais → ID do cliente OAuth → App para computador**.
5. Cole o **Client ID** e o **Client Secret** em **Ajustes → App do YouTube** → **Salvar**.
6. Em cada perfil: **Publicação → Conectar canal do YouTube** → escolha a conta/canal → no aviso "app não verificado": **Avançado → Acessar Nara**.

> ⚠️ Vídeos enviados por apps novos ficam **privados** até o Google aprovar a auditoria da API. Peça (grátis) em
> https://support.google.com/youtube/contact/yt_api_form ("ferramenta pessoal para publicar nos meus próprios canais").
> A cota grátis dá ~6 uploads/dia somando todos os canais.

## 4. Conectar o Instagram (para cada conta)

1. No Instagram: **Configurações → Tipo de conta → Mudar para conta profissional**.
2. **developers.facebook.com → Meus apps → Criar app** → caso de uso **Instagram** (gerenciar mensagens e conteúdo).
3. **Instagram → Configuração da API com login do Instagram**.
4. **Funções → Testadores do Instagram** → adicione o @ → no Instagram: **Configurações → Apps e sites → Convites de testador → Aceitar**.
5. **Gerar tokens de acesso → Adicionar conta → Gerar token** → copie (começa com `IGAA`).
6. Na Nara: perfil → **Publicação → Token do Instagram** → **Salvar** → **Testar conexão**.

O token dura 60 dias e a Nara renova sozinha toda semana.

---

## 5. Atom S3R — "Nara, bom dia"

O programa pronto é **`firmware/dist/nara-atoms3r-completo.bin`** (1,2 MB — o Atom S3R tem 8 MB).
Gravar a Nara **substitui** o xiaozhi (dá para voltar depois pelo M5Burner).

**Gravar (pelo navegador, sem instalar nada):**
1. Baixe o `.bin` do GitHub.
2. Conecte o Atom no PC pelo USB‑C **segurando o botão** por ~3 s (modo de gravação).
3. No Chrome/Edge abra **https://espressif.github.io/esptool-js/** → **Connect** → escolha a porta (COMx / USB JTAG).
4. **Flash Address `0x0`** → escolha o `.bin` → **Program** → espere 100% → desconecte e conecte de novo.

**Configurar:**
1. O Atom cria a rede Wi‑Fi **Nara-Setup** → conecte o celular ou o PC nela (abre a página sozinha, ou acesse http://192.168.4.1).
2. Preencha: Wi‑Fi de casa (**2,4 GHz**), **Endereço da Nara** (`http://IP-DO-PC:8080`, aparece na aba **Nara**), **Token do Atom** (mesma aba),
   marque **base de voz** e, se quiser, **escuta contínua**.
3. **Salvar e reiniciar**. Para mudar depois: segure o botão enquanto liga.

**Usar:** clique no botão e fale ("Nara, posta um vídeo extra hoje") · segure 1 s = briefing · com escuta contínua, é só falar "Nara, …".
Precisa da chave **Groq** (grátis) em Ajustes para ela entender sua voz.

> 💡 No roteador, reserve um **IP fixo** para este PC (DHCP → reserva por endereço MAC). Assim o endereço do Atom nunca muda.

---

## 6. Abrir a página de outro aparelho

- **Mesmo Wi‑Fi**: `http://IP-DO-PC:8080` (aparece em Ajustes → Sistema).
- **De qualquer lugar**: instale o **Tailscale** (grátis) no PC e no celular, mesma conta, e abra `http://100.x.x.x:8080` (IP do PC no Tailscale).

---

## 7. Limites e dicas

- **Google grátis**: limite diário de narrações por chave. Com 5 chaves (de contas diferentes) a Nara passa para a próxima quando uma esgota.
- **Claude pela assinatura**: os limites de uso do plano valem (zeram a cada 5 horas e há um teto semanal). Pesquisar atualidades usa um pouco mais.
- **Música de fundo**: coloque MP3 sem direitos em `C:\NARA\naraAi\server\data\music\` (todos) ou `...\music\<ID-do-perfil>\`.
- Vídeos já postados há mais de 5 dias são apagados do disco automaticamente.
- Registros: `C:\NARA\naraAi\server\data\nara.log` (ou Ajustes → Sistema).

## 8. Problemas comuns

| Problema | Solução |
|---|---|
| Página não abre | Reinicie o PC ou rode `install\run-nara-windows.cmd`. Veja o registro em `server\data\console.log`. |
| Esqueci a senha | Abra `C:\NARA\naraAi\server\data\config.json` e procure `adminToken`. |
| "Claude local sem login" | Num terminal: `claude auth login`. |
| Erro 429 na narração | As chaves do Google esgotaram hoje. Adicione mais chaves ou espere o dia seguinte. |
| YouTube "invalid_grant" | App em modo Teste: publique o app (passo 3.3) e conecte o canal de novo. |
| Vídeo ficou privado | Veja o aviso da auditoria no passo 3. |
| Atom não conecta | Segure o botão ao ligar → Nara-Setup → confira Wi‑Fi 2,4 GHz, IP do PC e token. |

---

## Estrutura (para curiosos)

```
server/src/index.js      servidor + API da página + rotas do Atom
server/src/scheduler.js  agenda (dias da semana, horários)
server/src/jobs.js       fila: tema → roteiro → voz → imagens → vídeo → postagem
server/src/ai/llm.js     DeepSeek, Claude (assinatura local ou API), Google TTS com rodízio de chaves
server/src/ai/writer.js  temas (engajamento + atualidades + data de hoje), roteiros, carrosséis
server/src/ai/voice.js   voz da Nara (Edge TTS) e transcrição (Groq)
server/src/media/        imagens e montagem com ffmpeg (legendas, logo final)
server/src/publish/      YouTube e Instagram
server/src/nara.js       briefing e pedidos (inclusive mudar configurações conversando)
server/data/             configurações, vídeos, estatísticas — NÃO apague
web/index.html           a página
firmware/                Atom S3R
install/                 instalador do Windows
```

Suas chaves ficam **só neste PC** (`server/data/config.json`), nunca no GitHub.
