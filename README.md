# 🤖 NARA — sua assistente que cria e posta conteúdo sozinha

A Nara roda **24 horas no Termux** do seu Samsung S23 Ultra e faz o mesmo fluxo que você faz hoje à mão — só que sozinha:

**Quem faz o quê:**

| Papel | Quem | Para quê |
|---|---|---|
| 🧠 **Cérebro** | DeepSeek | Conversar com você: briefing "Nara, bom dia", entender seus pedidos |
| ⚙️ **Motor** | Claude | Pesquisar temas, escrever roteiros e carrosséis, entender sua imagem de referência |
| 🎙️ **Narração** | Google AI Studio (grátis) | Só a voz que narra os vídeos |
| 🗣️ **Voz da Nara** | Edge TTS (grátis, sem chave) | A voz dela falando com você |
| 👂 **Ouvido** (opcional) | Groq (grátis) ou o microfone do celular | Entender o que você fala para o Atom |

```
 Tema (sua fila ou pesquisado pela Claude)
        │
        ▼
 Claude escreve o roteiro  ──►  Google (AI Studio) gera a narração
        │                                   │
        ▼                                   ▼
 Busca imagens na internet / gera por IA no estilo da sua referência
        │
        ▼
 ffmpeg monta o vídeo (zoom, legendas com palavra em destaque, música)
        │
        ▼
 Posta no YouTube (Shorts) e no Instagram (Reels / carrossel / imagem)
        │
        ▼
 Coleta seguidores e visualizações → "Nara, bom dia" conta tudo para você
```

- **Página de configuração** (este projeto, pasta `web/`): escolhe o perfil, quantos vídeos, estilo, legendas, referência visual, chaves de API, etc.
- **Vários perfis**: cada perfil = uma conta (YouTube + Instagram) com seu próprio estilo e agenda.
- **Atom S3R** ("Nara, bom dia"): briefing falado do dia e pedidos por voz.
- Você também pode falar com a Nara **digitando** no Painel.

---

## 📋 Índice
1. [O que você precisa](#1-o-que-você-precisa)
2. [Preparar o celular (bateria e apps)](#2-preparar-o-celular)
3. [Instalar a Nara no Termux](#3-instalar-a-nara-no-termux)
4. [Abrir a página e colar as chaves](#4-abrir-a-página-e-colar-as-chaves)
5. [Criar os perfis](#5-criar-os-perfis)
6. [Conectar o YouTube](#6-conectar-o-youtube)
7. [Conectar o Instagram](#7-conectar-o-instagram)
8. [Acessar do computador](#8-acessar-do-computador)
9. [Atom S3R — "Nara, bom dia"](#9-atom-s3r--nara-bom-dia)
10. [Pedidos que a Nara entende](#10-pedidos-que-a-nara-entende)
11. [Limites da versão grátis e dicas](#11-limites-da-versão-grátis-e-dicas)
12. [Problemas comuns](#12-problemas-comuns)

---

## 1. O que você precisa

| Item | Onde | Custo |
|---|---|---|
| **Termux** | F-Droid (NÃO use o da Play Store, está desatualizado) | grátis |
| **Termux:API** | F-Droid | grátis |
| **Termux:Boot** | F-Droid | grátis |
| **Chave DeepSeek** (cérebro) | https://platform.deepseek.com → API keys | pago por uso (centavos) |
| **Chave Claude** (motor) | https://platform.claude.com → API keys (coloque créditos em *Billing*) | pago por uso |
| **Chave Google AI Studio** (narração) | https://aistudio.google.com → *Get API key* | grátis (com limites) |
| **Chave Groq** (opcional, ouvir o Atom) | https://console.groq.com → API Keys | grátis |
| **Google Cloud (YouTube)** | https://console.cloud.google.com | grátis |
| **Meta for Developers (Instagram)** | https://developers.facebook.com | grátis |
| **Tailscale** (acessar do PC) | Play Store + PC | grátis |
| Navegador Chrome ou Edge no computador (gravar o Atom S3R) | no seu computador | grátis |

> Baixe o F-Droid em https://f-droid.org, instale, e dentro dele procure **Termux**, **Termux:API** e **Termux:Boot**.

---

## 2. Preparar o celular

Como ele vai ficar ligado 24h na tomada, faça isto **uma vez**:

1. **Configurações → Bateria → Limites de uso em segundo plano → Apps que nunca são suspensos** → adicione **Termux**, **Termux:API** e **Termux:Boot**.
2. **Configurações → Apps → Termux → Bateria → Sem restrições**. (Repita para Termux:API e Termux:Boot.)
3. **Configurações → Bateria → Mais configurações → Proteger bateria** (carregar só até 80–85%). **Muito importante** para a bateria não estufar ficando 24h na tomada.
4. Abra o **Termux:Boot** uma vez (só abrir e fechar) — isso libera a Nara a ligar sozinha quando o celular reiniciar.
5. Deixe o Wi‑Fi sempre ligado (Configurações → Conexões → Wi‑Fi → Avançado → manter ligado durante suspensão).

---

## 3. Instalar a Nara no Termux

Abra o Termux e cole os comandos **um bloco por vez** (aperte Enter depois de cada um):

```bash
pkg update -y && pkg install -y git gh
```

Faça login no GitHub (para baixar o projeto, que é privado):

```bash
gh auth login
```
> Escolha: **GitHub.com** → **HTTPS** → **Y** → **Login with a web browser**. Ele mostra um código; abra o link no navegador, cole o código e autorize.

Baixe o projeto e instale tudo:

```bash
cd ~ && gh repo clone gamificappt-source/naraAi && cd naraAi
git checkout claude/nara-content-automation-vuhcas
bash install/termux-setup.sh
```

No final aparece algo assim — **anote a senha**:

```
 NARA rodando na porta 8080
 No celular:   http://localhost:8080
 Senha da página: a1b2c3d4
 Token do Atom S3R: 9f8e7d6c5b4a
```

Atalhos que ficam disponíveis (feche e abra o Termux uma vez):

| Comando | O que faz |
|---|---|
| `nara-log` | mostra o que a Nara está fazendo (Ctrl+C para sair) |
| `nara-start` | liga a Nara |
| `nara-stop` | desliga |
| `nara-update` | baixa a versão nova do projeto e reinicia |

A Nara **reinicia sozinha** se travar, e **liga sozinha** quando o celular reinicia (Termux:Boot).

---

## 4. Abrir a página e colar as chaves

1. No modo DeX, abra o navegador e entre em **http://localhost:8080**
2. Digite a senha.
3. Aba **Chaves e ajustes**:
   - **DeepSeek** (cérebro) → cole a chave (`sk-...`).
   - **Claude** (motor) → cole a chave (`sk-ant-...`).
   - **Google AI Studio** (narração) → cole a chave (`AIza...`). É usada **só** para narrar os vídeos (a mesma voz do AI Studio que você já usa).
   - (Opcional) **Groq** → para a Nara entender o que você fala direto no Atom S3R.
   - (Opcional) **Pexels** → https://www.pexels.com/api — mais fotos grátis e bonitas.
   - Clique **Salvar** e depois **Testar chaves**. Tem que aparecer `ok ✅` em cada uma.
4. Em **Nara (voz e Atom S3R)** escolha a voz (Thalita, Francisca ou Antônio) e clique **🔊 Ouvir a voz da Nara** — ela fala pelo alto-falante do celular (ou pela caixa de som Bluetooth / monitor HDMI conectado).

> 💰 **Custo da Claude:** cada roteiro custa poucos centavos de dólar. Em **Chaves e ajustes → Geral → Capricho da Claude** você escolhe *Rápido/barato*, *Equilibrado* (padrão) ou *Caprichado*. Se um dia a Claude recusar um tema sensível, a própria API tenta automaticamente outro modelo Claude; se mesmo assim falhar, o DeepSeek escreve o roteiro.

---

## 5. Criar os perfis

Aba **Perfis → + Novo perfil**. Para cada perfil:

- **Básico**: nicho, público, tom. Na **Fila de temas** coloque temas que você quer (1 por linha). Se ficar vazio, a Nara pesquisa sozinha temas novos sem repetir.
- **Quantidade e horários**: vídeos/carrosséis/imagens por dia e a janela de horário (ou horários fixos).
  - **Postar sozinha**: no começo **deixe desmarcado** — os conteúdos ficam no Painel para você ver e clicar em *Aprovar e postar*. Quando gostar do resultado, marque e ela passa a postar sozinha.
- **Vídeo**: formato (vertical/horizontal), duração, estilo (2D, 3D, documentário…), de onde vêm as imagens e **cole aqui o seu prompt do vídeo** (o mesmo que você usa hoje).
- **Legendas**: fonte, cores, posição, quantas palavras aparecem por vez.
- **Referência visual**: envie a imagem de referência (ex.: um frame 2D de investigação). O Google analisa o estilo e a Nara segue essa linha nas imagens geradas por IA.
- **Carrossel**: número de slides, instruções e como escrever a legenda.
- Clique **💾 Salvar perfil**.

**Teste:** no **Painel**, escolha o perfil, tipo *Vídeo*, clique **Produzir agora** e acompanhe. Leva de 3 a 10 minutos.

**Música de fundo:** coloque arquivos `.mp3` sem direitos autorais (ex.: Biblioteca de áudio do YouTube) em
`~/naraAi/server/data/music/` (vale para todos) ou em `~/naraAi/server/data/music/<ID-do-perfil>/` (só aquele perfil).
Para copiar do armazenamento do celular: `termux-setup-storage` e depois `cp ~/storage/downloads/*.mp3 ~/naraAi/server/data/music/`.

---

## 6. Conectar o YouTube

Faça **uma vez** (serve para todos os canais):

1. Acesse https://console.cloud.google.com → crie um projeto chamado **Nara**.
2. Menu **APIs e serviços → Biblioteca** → procure **YouTube Data API v3** → **Ativar**.
3. **APIs e serviços → Tela de consentimento OAuth** (ou "Google Auth Platform"):
   - Tipo: **Externo**. Nome do app: Nara. E-mail: o seu.
   - Em **Público-alvo**, clique **PUBLICAR APP** (colocar "Em produção").
     ⚠️ Se ficar em "Teste", o login do YouTube **expira a cada 7 dias**.
4. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth** → Tipo: **App para computador** (Desktop) → Criar.
5. Copie o **Client ID** e o **Client Secret** e cole na página da Nara em **Chaves e ajustes → YouTube** → Salvar.

Depois, **para cada perfil**:

1. Aba **Perfis** → escolha o perfil → card **YouTube** → **Conectar canal do YouTube**.
2. Entre com a conta Google e **escolha o canal certo** (se tiver vários canais/contas de marca, ele pergunta).
3. Vai aparecer um aviso "O Google não verificou este app" → **Avançado → Acessar Nara (não seguro)** → Permitir. (É o seu próprio app, é seguro.)
4. Se você fez isso **no navegador do celular**, aparece "✅ YouTube conectado".
   Se fez **no computador**, a página vai dar erro de "não foi possível acessar localhost" — **é normal**: copie o endereço inteiro da barra do navegador, volte na Nara e cole no campo que apareceu → **Confirmar**.

> ⚠️ **Importante — vídeos privados no começo:** o Google deixa como **privado** todo vídeo enviado por apps novos que ainda não passaram pela auditoria da API do YouTube. Para liberar a postagem pública, preencha (grátis) o formulário **"YouTube API Services – Audit and Quota Extension Form"** em https://support.google.com/youtube/contact/yt_api_form explicando que é uma ferramenta pessoal para publicar nos seus próprios canais. Enquanto não aprovam, a Nara sobe os vídeos e você só precisa mudar para público no YouTube Studio.
>
> A cota grátis da API dá ~6 uploads por dia **somados** (cada upload gasta 1.600 de 10.000 pontos). Para mais, peça aumento de cota no mesmo formulário.

---

## 7. Conectar o Instagram

A conta do Instagram precisa ser **Profissional** (Criador de conteúdo ou Empresa): no app do Instagram → Configurações → Tipo de conta e ferramentas → Mudar para conta profissional.

Faça **uma vez**:

1. Acesse https://developers.facebook.com → **Meus apps → Criar app**.
2. Caso de uso: **"Gerenciar mensagens e conteúdo no Instagram"** (Instagram API). Tipo: Empresa. Crie.
3. No painel do app: **Casos de uso → Instagram → API setup with Instagram login (Configuração da API com login do Instagram)**.
4. Em **Funções do app → Funções → Testadores do Instagram**, adicione o @ de cada conta. Depois, no Instagram de cada conta: **Configurações → Apps e sites → Convites de testador → Aceitar**.

Para **cada perfil**:

1. No passo **"Gerar tokens de acesso"**, clique **Adicionar conta**, entre com o Instagram daquele perfil e autorize.
2. Clique **Gerar token** e copie o token (começa com `IGAA...`).
3. Na Nara: aba **Perfis** → card **Instagram** → cole o token → marque **Postar no Instagram** → **Salvar perfil** → **Testar conexão**.
   (O ID da conta é descoberto sozinho.)

O token dura 60 dias, mas a Nara **renova sozinha** toda semana. Se ficar mais de 60 dias desligada, gere um novo.

> Como o Instagram exige que as imagens estejam em um link público, a Nara envia cada imagem para um armazenamento temporário (apaga em 24h) só para o Instagram buscar. Os Reels são enviados direto.

---

## 8. Acessar do computador

O jeito mais fácil e seguro é o **Tailscale** (grátis), que cria uma rede privada entre o celular e o PC, funciona de qualquer lugar:

1. Instale o **Tailscale** no celular (Play Store) e no computador (https://tailscale.com/download). Entre com a **mesma conta** nos dois.
2. No app do Tailscale do celular, veja o IP dele (começa com **100.**).
3. No navegador do PC, abra **http://100.x.x.x:8080** (o IP do celular).

É a **mesma página**: qualquer coisa que você mudar no PC já vale na hora dentro do Termux. A aba **Sistema** da página mostra os endereços.

Em casa, na mesma rede Wi‑Fi, também funciona pelo IP local (ex.: `http://192.168.0.15:8080`).

> **E o Netlify?** O projeto tem `netlify.toml` e a página pode ser publicada lá (ela pede o endereço da Nara no login). Mas o Netlify usa `https://` e o navegador bloqueia a página de conversar com o celular por `http://`. Para funcionar, o celular precisaria de um endereço `https` (por exemplo, um túnel da Cloudflare com domínio próprio). Por isso o **Tailscale é o recomendado**: zero configuração extra e ninguém de fora acessa.

---

## 9. Atom S3R — "Nara, bom dia"

### Qual hardware
- O **AtomS3R‑CAM sozinho não tem microfone nem alto‑falante**. Ele funciona como **botão**: clicou → a Nara dá o briefing pelo **alto‑falante do celular**.
- Se você tem o kit **AtomS3R‑CAM AI Chatbot** (ou encaixou a **Atomic Echo Base / Voice Base**), ele tem microfone e alto‑falante: você fala "**Nara, bom dia**" ou "**Nara, posta um vídeo extra hoje**" e ela responde.

### Gravar o programa no Atom (pelo navegador, sem instalar nada)
O programa já está pronto e compilado: **`firmware/dist/nara-atoms3r-completo.bin`**.

1. No GitHub, abra esse arquivo e clique em **Download** (baixe para o computador).
2. Ligue o Atom no computador com cabo USB‑C. **Segure o botão do Atom por ~3 segundos** enquanto conecta o cabo (modo de gravação).
3. No **Chrome ou Edge** do computador, abra **https://espressif.github.io/esptool-js/**
4. Clique **Connect** → escolha a porta (algo como "USB JTAG/serial" ou "COM3") → Conectar.
5. Em **Flash Address** deixe **0x0**, clique em **Escolher arquivo** e selecione `nara-atoms3r-completo.bin`.
6. Clique **Program** e espere chegar a 100%. Desconecte e conecte o cabo de novo (ou ligue numa tomada USB).

### Configurar o Atom (pelo celular)
1. Na primeira vez, o Atom cria uma rede Wi‑Fi chamada **Nara-Setup**. Conecte o celular (ou PC) nela.
2. Abre sozinha uma página (se não abrir, acesse **http://192.168.4.1**). Preencha:
   - Wi‑Fi e senha da sua casa (**2,4 GHz**);
   - **Endereço da Nara** — aparece na aba **Sistema** da página, ex.: `http://192.168.0.15:8080`
     💡 No roteador, reserve um IP fixo para o celular, assim o endereço nunca muda;
   - **Token do Atom S3R** — página → Chaves e ajustes;
   - marque se tem a **base de voz** e se quer **escuta contínua**.
3. **Salvar e reiniciar**. Pronto.
4. Para mudar depois: **segure o botão enquanto liga o Atom** → ele volta a criar a rede Nara-Setup.

> (Para quem quiser mexer no código: `firmware/nara-atom` é um projeto PlatformIO — `pio run -t upload`.)

### Como usar
| Ação | O que acontece |
|---|---|
| **Segurar o botão 1s** | Briefing do dia |
| **Clicar o botão** | Com base de voz + chave Groq: o Atom ouve seu pedido. Sem Groq: quem escuta é o **microfone do celular** (fale depois do bip do Android). Sem base de voz: briefing |
| **Falar "Nara, …"** (escuta contínua, precisa da chave Groq) | Ela ouve e responde |

Na página, **Chaves e ajustes → Nara**, você escolhe se a voz sai **pelo celular**, **pelo Atom** (base de voz) ou os dois, e pode marcar um **briefing automático** todo dia num horário. A voz da Nara é **grátis e ilimitada** (Edge TTS) — não gasta a cota do Google.

---

## 10. Pedidos que a Nara entende

Pela voz ou digitando no Painel:

- "Nara, bom dia" → como foi ontem, quem ganhou/perdeu seguidores, agenda de hoje.
- "Nara, posta um vídeo extra hoje no perfil Casos Reais"
- "Nara, faz um carrossel sobre o caso X no perfil Y"
- "Nara, foca mais no perfil Y essa semana" (+1 vídeo por dia por 7 dias)
- "Nara, para de focar no perfil Y"
- "Nara, pausa tudo" / "Nara, volta a postar"
- "Nara, pausa o perfil Y"
- "Nara, anota o tema 'a cidade que sumiu' para o perfil Y"
- "Nara, muda o perfil Y para 3 vídeos por dia"
- "Nara, qual perfil cresceu mais ontem?"

---

## 11. Limites da versão grátis e dicas

- **Google AI Studio grátis**: usado **só para narrar os vídeos**. A narração tem um **limite diário pequeno** de pedidos. Veja seus limites em https://aistudio.google.com → *Rate limits*. Se estourar, a produção falha com erro 429 e você pode clicar **Tentar de novo** depois. Com muitos perfis/vídeos por dia, considere ativar o faturamento no AI Studio.
- A **voz da Nara** (Edge TTS) e o **microfone do celular** são grátis e não têm cota.
- A **escuta contínua** do Atom usa a Groq a cada barulho — em lugar barulhento gasta a cota grátis da Groq. Aumente a sensibilidade ou use só o botão.
- **Claude** cobra por uso (poucos centavos por roteiro). Acompanhe em platform.claude.com → Usage.
- **DeepSeek** cobra por uso, mas um roteiro custa menos de 1 centavo.
- **Imagens**: as fotos vêm do Openverse, Wikimedia Commons e Pexels (licenças livres). As imagens por IA vêm do Pollinations (grátis). Para conteúdo sobre pessoas e casos reais, prefira "Só internet" ou "Misto".
- O celular apaga sozinho os arquivos de vídeos postados há mais de 5 dias.
- Os modelos de IA mudam de nome com o tempo. Se um dia der erro de "model not found", troque o nome em **Chaves e ajustes → Geral**.

---

## 12. Problemas comuns

| Problema | Solução |
|---|---|
| Página não abre | No Termux rode `nara-start` e depois `nara-log` para ver o erro. |
| Esqueci a senha | No Termux: `grep adminToken ~/naraAi/server/data/config.json` |
| Nara para quando desligo a tela | Refaça o passo 2 (bateria sem restrições) e veja se aparece a notificação "Termux – wake lock". |
| Erro 429 na narração | Cota grátis do Google acabou por hoje. Clique "Tentar de novo" amanhã ou reduza vídeos/dia. |
| YouTube "invalid_grant" | O login expirou (app em modo Teste). Publique o app (passo 6.3) e conecte o canal de novo. |
| Vídeo no YouTube ficou privado | Veja o aviso de auditoria no passo 6. |
| Instagram "Media download has failed" | Tente de novo; se repetir, gere um novo token. |
| Legenda com fonte errada | Rode de novo `bash install/termux-setup.sh` para baixar as fontes. |
| Atom não conecta | Segure o botão ao ligar para abrir a rede Nara-Setup e confira Wi‑Fi 2,4 GHz, o endereço (IP do celular) e o token. |
| Nara não fala | Teste em Chaves e ajustes → 🔊 Ouvir a voz da Nara. Se não sair som, confira se o **Termux:API** está instalado e rode de novo `bash install/termux-setup.sh`. |

---

## 🗂️ Estrutura do projeto (para curiosos)

```
server/            → o "cérebro" que roda no Termux (Node.js, sem dependências)
  src/index.js       servidor web + API da página + rotas do Atom
  src/scheduler.js   agenda do dia
  src/jobs.js        fila de produção (roteiro → voz → imagens → vídeo → postagem)
  src/ai/llm.js      DeepSeek (cérebro), Claude (motor), Google (narração)
  src/ai/voice.js    voz grátis da Nara e transcrição
  src/media/         busca de imagens e montagem com ffmpeg
  src/publish/       YouTube e Instagram
  src/analytics.js   seguidores e visualizações
  src/nara.js        briefing e pedidos falados
  data/              (criada sozinha) configurações, vídeos, estatísticas — NÃO apague
web/index.html     → a página de configuração
firmware/nara-atom → código do Atom S3R
firmware/dist      → programa pronto para gravar pelo navegador
install/           → instalação no Termux
```

Suas chaves ficam **somente no celular** (`server/data/config.json`), nunca no GitHub.
