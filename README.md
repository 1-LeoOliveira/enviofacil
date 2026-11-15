# Envio Fácil — DETRAN/SC

Plataforma web que digitaliza a troca de documentos entre atendente e cidadão
durante o atendimento presencial: o atendente gera uma sessão digital com QR Code,
o cidadão envia os documentos pelo próprio celular, e o atendente recebe, confere,
aprova ou devolve — tudo em tempo real.

> **Ambiente de demonstração.** A identificação do cidadão vem de uma base
> **fictícia** (`demo_cidadaos`), claramente sinalizada na interface. A integração
> com a base institucional do DETRAN/SC está preparada por adaptador, mas não é
> simulada como se fosse real. Antes de qualquer uso em produção o sistema precisa
> passar pelas áreas de segurança da informação, proteção de dados e governança.

| | |
|---|---|
| **Front-end** | Vite 6 + React 18 + TypeScript + Tailwind CSS |
| **Back-end** | Node 22 + Express + TypeScript + Socket.IO |
| **Banco** | MySQL 8 (SQL explícito, sem ORM) |
| **Infra** | Docker Compose — ou MySQL local, sem Docker |
| **Documentação** | [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) |

---

## 1. Subir o projeto

Há dois caminhos. Use o **A** se o Docker não estiver disponível nesta máquina.

### Opção A — sem Docker (MySQL local, não exige virtualização)

```powershell
# 1. MySQL 8 portátil em %LOCALAPPDATA%\EnvioFacil (baixa ~250 MB na 1ª vez)
npm run banco:instalar

# 2. dependências e carga inicial
npm run instalar
npm run semear

# 3. banco + API + front-end em segundo plano
npm run app:iniciar
```

Abra **http://localhost:5173**.

| Comando | O que faz |
|---|---|
| `npm run app:iniciar` | sobe banco, API (4000) e front-end (5173) em segundo plano |
| `npm run app:status` | mostra o que está no ar |
| `npm run app:logs` | últimas linhas de `.logs/api.log` e `.logs/web.log` |
| `npm run app:parar` | encerra API e front-end (o banco continua) |
| `npm run banco:parar` | encerra o MySQL local |

Para trabalhar com recarga automática e ver o log no próprio terminal, use dois
terminais com `npm run dev:api` e `npm run dev:web` no lugar de `app:iniciar`.

O MySQL sobe em `127.0.0.1:3307`, isolado de qualquer instalação existente.
Comandos: `npm run banco:iniciar | banco:parar | banco:status | banco:console | banco:remover`.

As configurações locais ficam em [`api/.env`](api/.env) (banco local + modo sem login);
as chaves de segurança vêm do `.env` da raiz.

### Opção B — com Docker

```bash
cp .env.example .env
node -e "const c=require('crypto');for(const k of ['JWT_SECRET','DATA_ENCRYPTION_KEY','CPF_HASH_KEY','FILE_SIGNING_KEY'])console.log(k+'='+c.randomBytes(32).toString('hex'))"
# cole as quatro chaves no .env

docker compose up -d --build
docker compose logs -f api
```

| Serviço | Endereço |
|---|---|
| Aplicação (Docker) | http://localhost:8080 |
| Aplicação (dev, Vite) | http://localhost:5173 |
| API | http://localhost:4000/api |
| Saúde da API | http://localhost:4000/health |
| Adminer (opcional) | `docker compose --profile ferramentas up -d adminer` → http://localhost:8081 |

As migrações e a carga inicial rodam automaticamente quando a API sobe.

### Se o Docker não iniciar

Sintoma: *"Virtualization is disabled in firmware"* no Docker Desktop, ou
`request returned 500 Internal Server Error` no `docker compose`.

A engine Linux do Docker Desktop precisa de **virtualização por hardware ligada na
BIOS/UEFI**. Para conferir:

```powershell
(Get-ComputerInfo).HyperVRequirementVirtualizationFirmwareEnabled   # precisa ser True
```

Se vier `False`, ligue no firmware (não há solução por software):

1. Reinicie e entre no setup da BIOS/UEFI (geralmente `Del` ou `F2` na inicialização).
2. Em placas **AMD**, procure `SVM Mode` (normalmente em *Advanced → CPU Configuration*
   ou *OC → Overclocking → Advanced CPU Configuration*) e mude para **Enabled**.
   Em placas Intel, o equivalente é `Intel Virtualization Technology (VT-x)`.
3. Salve e saia (`F10`), e deixe o Windows iniciar.
4. Se o WSL ainda não existir: `wsl --install` como administrador e reinicie.

Enquanto isso, a **Opção A** roda o projeto inteiro sem Docker e sem virtualização.

### Para testar com o celular na mesma rede

O QR Code aponta para `APP_PUBLIC_URL`. Com `localhost`, o celular lê o QR e tenta
abrir o *próprio* aparelho — por isso não funciona. Sem Docker, um comando resolve:

```powershell
npm run app:rede     # detecta o IP da máquina, grava em api/.env e reinicia a API
npm run app:local    # volta para localhost
```

Depois disso, gere um **novo** atendimento: QR Codes criados antes ainda carregam a
URL antiga. O celular precisa estar na mesma rede (Wi-Fi do mesmo roteador).

Se a página não abrir no celular, é o firewall do Windows. Como administrador:

```powershell
netsh advfirewall firewall add rule name="Envio Facil 5173" dir=in action=allow protocol=TCP localport=5173
```

Com Docker, ajuste `APP_PUBLIC_URL` e `CORS_ORIGINS` no `.env` da raiz (porta 8080)
e rode `docker compose up -d`.

Observação: o envio funciona em HTTP na rede local porque a foto usa o seletor de
arquivos do próprio celular (`<input capture>`), que não exige HTTPS. Em produção,
com TLS, nada muda no código.

---

## 2. Acesso

### Modo atual: sem tela de login

Para agilizar o desenvolvimento, o `api/.env` traz `LOGIN_DESABILITADO=true`:
a aplicação abre direto no painel do atendente e o cabeçalho tem um seletor para
alternar entre **Atendente, Supervisor e Administrador** — útil para conferir as
permissões de cada perfil. Uma faixa vermelha avisa que o modo está ligado.

A autenticação real continua inteira no código (login, senha com bcrypt, bloqueio
por tentativas, JWT, auditoria). Para voltar a exigir login, apague a linha
`LOGIN_DESABILITADO=true` de `api/.env` e reinicie a API. O modo é **ignorado em
produção** (`NODE_ENV=production`), por segurança.

### Quando o login está ativo

| Perfil | E-mail | Senha |
|---|---|---|
| Administrador | `admin@enviofacil.sc.gov.br` | `Admin@2025` |
| Supervisor | `supervisor@enviofacil.sc.gov.br` | `Super@2025` |
| Atendente | `atendente@enviofacil.sc.gov.br` | `Atende@2025` |

### CPFs fictícios aceitos na identificação do cidadão

```
529.982.247-25   Maria Aparecida da Silva
111.444.777-35   João Pedro Oliveira
390.533.447-05   Ana Carolina Schmitt
123.456.789-09   Carlos Eduardo Berg
987.654.321-00   Luciana Hoffmann Costa
```

> Em produção, `SEED_DEMO=false` e `CIDADAO_PROVIDER=http` desligam toda a base
> fictícia e passam a consultar a API institucional.

---

## 3. Fluxo de uso (roteiro de 2 minutos)

1. Abra http://localhost:5173 — você já entra como atendente.
2. **Novo atendimento** → informe um CPF da lista → confirme a identificação.
3. Escolha o serviço (ex.: *Transferência de propriedade*). A lista de documentos
   carrega sozinha; marque, desmarque ou adicione um documento específico.
4. **Gerar sessão e QR Code**.
5. No celular, leia o QR Code — ou abra http://localhost:5173/acesso em outra aba
   e digite o código curto.
6. No portal, anexe arquivos (PDF/JPG/PNG), use *Tirar foto* no celular, e toque
   em **Enviar documentos**.
7. Volte ao **painel de recebimento**: os arquivos aparecem sem recarregar a página.
   Visualize, baixe, **aprove** ou **rejeite** com motivo — o cidadão vê a mudança
   na hora.
8. Disponibilize um comprovante em **Enviar ao cidadão**; ele aparece no celular
   para download.
9. **Concluir atendimento** encerra a sessão e revoga o acesso do cidadão.

---

## 4. Testes

```bash
npm run teste:unitario     # cifra, CPF, tokens, links assinados (7 testes)
npm run teste:integracao   # fluxo e segurança ponta a ponta (74 verificações)
```

O roteiro de integração exige a API no ar e cobre o fluxo completo e,
principalmente, o que **deve** falhar: cidadão tentando alcançar a sessão de outro,
atendente abrindo o atendimento de outro servidor, link de arquivo forjado ou
reaproveitado, arquivo com extensão disfarçada, PDF com script, envio incompleto e
uso de sessão já encerrada.

---

## 5. Estrutura

```
Envio Facil/
├── docker-compose.yml       # banco + api + web + adminer (Opção B)
├── .env.example             # variáveis e chaves (copiar para .env)
├── api/.env                 # ambiente local sem Docker + modo sem login
├── db/migrations/           # esquema SQL versionado
├── docs/ARQUITETURA.md      # arquitetura, banco, fluxos, riscos, fases
├── scripts/
│   ├── app-local.ps1        # sobe/para API e front-end em segundo plano
│   ├── mysql-local.ps1      # MySQL 8 portátil, sem Docker
│   └── teste-integracao.mjs # teste de fluxo e segurança
├── api/                     # API, regras de negócio, tempo real, storage
│   └── src/
│       ├── config/          # variáveis de ambiente validadas
│       ├── db/              # pool, migrações, carga inicial
│       ├── lib/             # cifra, auditoria, parâmetros, datas, erros, log
│       ├── middleware/      # autenticação, perfis, upload, limites
│       ├── modules/         # auth, sessoes, portal, arquivos, catalogo, admin
│       ├── integrations/    # adaptadores (base de cidadãos)
│       ├── realtime/        # Socket.IO, salas por sessão
│       ├── storage/         # armazenamento cifrado (AES-256-GCM)
│       └── jobs/            # expiração de sessões e retenção LGPD
└── web/                     # SPA (atendente, admin e portal do cidadão)
    └── src/
        ├── pages/atendente/ # painel, novo atendimento, recebimento
        ├── pages/portal/    # portal do cidadão (mobile-first)
        ├── pages/admin/     # unidades, usuários, serviços, indicadores, auditoria
        ├── layouts/         # casca do servidor
        ├── components/      # interface compartilhada
        └── lib/             # api, autenticação, socket, formatação
```

---

## 6. Segurança implementada

- **Sessões**: token de 256 bits na URL (nunca o CPF), guardado como SHA-256 e
  também cifrado para reexibir o QR; código curto sem caracteres ambíguos;
  expiração configurável, prorrogação e revogação pelo atendente.
- **Dados pessoais**: CPF em HMAC-SHA256 (busca) + AES-256-GCM (exibição
  autorizada e auditada) + versão mascarada nas telas. Logs e auditoria sem CPF.
- **Arquivos**: validação por extensão, MIME **e** *magic bytes*; recusa de PDF
  com JavaScript ou anexo embutido; limites de tamanho e quantidade; conteúdo
  cifrado em repouso com AES-256-GCM, chave fora do banco; entrega apenas por
  link assinado de 2 minutos, restrito a um arquivo, com `nosniff` e sandbox.
- **Autorização**: verificada no servidor em toda rota — atendente só alcança as
  próprias sessões, supervisor a sua unidade, cidadão apenas a sessão do seu token.
- **Abuso**: rate limit por rota (login, acesso ao portal, upload, download) e
  bloqueio progressivo do usuário após tentativas incorretas.
- **LGPD**: finalidade restrita ao atendimento, retenção configurável com descarte
  automático do conteúdo (metadados preservados para auditoria) e trilha de
  auditoria das operações sensíveis.

### Pendente para produção (decisão institucional)

SSO (gov.br/LDAP), antivírus na ingestão, KMS/HSM para as chaves, TLS com
certificado oficial, validação documental oficial, teste de intrusão independente
e parecer formal de segurança, proteção de dados e governança. E, obrigatoriamente,
`LOGIN_DESABILITADO` fora do ambiente.

---

## 7. Situação por fase

| Fase | Situação |
|---|---|
| 1 — MVP (login, catálogo, identificação, sessão, QR, portal, upload, recebimento) | Implementada |
| 2 — Comunicação (aprovação, rejeição, correção, tempo real, arquivos do atendente) | Implementada |
| 3 — Administração (unidades, guichês, usuários, configurações, indicadores, auditoria) | Núcleo implementado; exportação de relatórios pendente |
| 4 — Integrações (base institucional, sistemas internos, validação documental) | Adaptadores prontos, integrações a contratar |

Funcionalidades ainda não implementadas não aparecem como botões inertes: o que
está na interface tem comportamento real, e o que depende de integração externa
está sinalizado como tal.
