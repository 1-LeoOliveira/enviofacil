# Envio Fácil — Arquitetura Técnica

> Plataforma de troca digital de documentos no atendimento presencial — DETRAN/SC
> **Status:** MVP (Fases 1 e 2 implementadas, Fase 3 parcial, Fase 4 preparada por adaptadores)
> **Ambiente:** DEMONSTRAÇÃO — a base de cidadãos é fictícia e identificada como tal.

---

## 1. Arquitetura recomendada

### 1.1 Visão de componentes

```
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│  Painel do Atendente │   │   Portal do Cidadão  │   │ Painel Administrativo│
│  (SPA React/Vite)    │   │  (SPA mobile-first)  │   │  (SPA React/Vite)    │
└──────────┬───────────┘   └──────────┬───────────┘   └──────────┬───────────┘
           │  HTTPS / JWT             │ HTTPS / token de sessão  │
           └──────────────┬───────────┴──────────────┬───────────┘
                          ▼                          ▼
                 ┌─────────────────────────────────────────┐
                 │   Edge / Reverse Proxy (Nginx)          │
                 │   TLS, cabeçalhos, roteamento, cache    │
                 └───────────────┬─────────────────────────┘
                                 ▼
          ┌────────────────────────────────────────────────────────┐
          │  API HTTP (Node + Express + TypeScript)                │
          │  ┌──────────┬──────────┬───────────┬────────────────┐  │
          │  │ AuthN/Z  │ Sessões  │ Documentos│ Admin/Relatório│  │
          │  └──────────┴──────────┴───────────┴────────────────┘  │
          │  Serviço de tempo real (Socket.IO, salas por sessão)   │
          │  Serviço de armazenamento (cifra AES-256-GCM)          │
          │  Camada de integração (adaptadores institucionais)     │
          └───────┬───────────────────────┬────────────────────┬───┘
                  ▼                       ▼                    ▼
        ┌──────────────────┐  ┌────────────────────┐  ┌──────────────────┐
        │  MySQL 8         │  │ Storage de arquivos│  │ Integrações      │
        │  dados, metadados│  │ (volume privado /  │  │ futuras (base de │
        │  e auditoria     │  │  S3 compatível)    │  │ cidadãos, etc.)  │
        └──────────────────┘  └────────────────────┘  └──────────────────┘
```

### 1.2 Separação exigida pelo item 11 da proposta

| Responsabilidade | Onde está | Observação |
|---|---|---|
| Front-end do atendente | `web/src/pages/atendente/` | Rotas `/app/**`, exige JWT de servidor |
| Portal do cidadão | `web/src/pages/portal/` | Rotas `/s/:token` e `/acesso`, sem conta |
| Painel administrativo | `web/src/pages/admin/` | Rotas `/admin/**`, exige perfil ADMIN |
| API e regras de negócio | `api/src/modules/` | Um módulo por domínio |
| Armazenamento de documentos | `api/src/storage/` | Interface `FileStorage`; implementação local cifrada |
| Comunicação em tempo real | `api/src/realtime/` | Socket.IO, salas isoladas por sessão |
| Autenticação e autorização | `api/src/middleware/auth.ts` | JWT de servidor e JWT de cidadão (escopo de sessão) |
| Integração institucional | `api/src/integrations/cidadaos/` | Adaptadores `demo` e `http` (REST institucional) |

Cada bloco é substituível: trocar o storage local por S3/MinIO, ou o diretório de
cidadãos demo pela API institucional, é alterar uma variável de ambiente.

---

## 2. Estrutura do banco de dados

MySQL 8, `utf8mb4`, InnoDB. Chaves estrangeiras com `RESTRICT` para cadastros e
`CASCADE` para dados dependentes de sessão.

```
unidades ──┬─< guiches ──┬─< usuarios
           │             │
           └─────────────┴─< sessoes >── tipos_atendimento ──< documentos_exigidos
                              │
                              ├─< sessao_documentos ──< arquivos
                              ├─< arquivos (origem = ATENDENTE)
                              └─< eventos_sessao

configuracoes   auditoria   demo_cidadaos (ambiente de demonstração)
```

| Tabela | Função | Pontos de atenção |
|---|---|---|
| `unidades` | Unidades de atendimento | Base do isolamento de dados |
| `guiches` | Guichês por unidade | Único por (`unidade_id`, `identificacao`) |
| `usuarios` | Servidores (ADMIN / SUPERVISOR / ATENDENTE) | Senha com bcrypt; bloqueio por tentativas |
| `tipos_atendimento` | Catálogo de serviços | Configurável pelo administrador |
| `documentos_exigidos` | Documentos por serviço | Ordenáveis, obrigatório/opcional |
| `sessoes` | Sessão digital do atendimento | `token_hash` (SHA-256), `codigo_curto`, CPF cifrado + HMAC |
| `sessao_documentos` | Checklist materializado na sessão | Status individual, motivo de rejeição, orientação |
| `arquivos` | Arquivos nos dois sentidos | Cifrados em repouso (IV + auth tag por arquivo), SHA-256 do claro |
| `eventos_sessao` | Linha do tempo da sessão | Alimenta o tempo real e o histórico |
| `auditoria` | Trilha de auditoria | Ator, ação, entidade, IP, user-agent |
| `configuracoes` | Parâmetros operacionais | TTL de sessão, limites de arquivo, retenção |
| `demo_cidadaos` | **Base fictícia** de demonstração | Só é consultada com `CIDADAO_PROVIDER=demo` |

O CPF **nunca** é gravado em claro nas tabelas operacionais:

- `cpf_hash` = HMAC-SHA256(CPF, `CPF_HASH_KEY`) → permite busca e deduplicação;
- `cpf_cipher` = AES-256-GCM(CPF, `DATA_ENCRYPTION_KEY`) → permite exibição autorizada e auditada;
- `cpf_mascarado` → é o que trafega para as telas por padrão.

O script completo está em [`db/migrations/001_schema.sql`](../db/migrations/001_schema.sql).

---

## 3. Fluxo completo de funcionamento

```
ATENDENTE                      API                        CIDADÃO (celular)
    │                           │                                │
    │ 1. login (e-mail/senha)   │                                │
    ├──────────────────────────>│ JWT 8h + auditoria             │
    │                           │                                │
    │ 2. "Novo atendimento"     │                                │
    │    informa CPF            │                                │
    ├──────────────────────────>│ 3. adaptador de cidadãos       │
    │<──────────────────────────┤    retorna nome (demo/inst.)   │
    │ 4. confirma identificação │                                │
    │ 5. escolhe o serviço      │                                │
    │<──────────────────────────┤ documentos exigidos do serviço │
    │ 6. ajusta a lista         │                                │
    │ 7. cria a sessão          │                                │
    ├──────────────────────────>│ token (32B) + código curto     │
    │<──────────────────────────┤ QR Code + link + expiração     │
    │                           │                                │
    │ 8. mostra o QR ao cidadão │ ──────── QR / código ────────> │
    │                           │<───────────────────────────────┤ 9. abre /s/<token>
    │                           │  valida token/expiração/status │
    │                           │  emite JWT de cidadão (escopo) │
    │ 10. evento "acessou"      │<───── socket.io ───────────────┤
    │<──────────────────────────┤                                │
    │                           │<───────────────────────────────┤ 11. anexa arquivos
    │                           │  valida tipo/magic bytes/tam.  │
    │                           │  cifra e grava no storage      │
    │ 12. aparece no painel     │<───────────────────────────────┤ 13. "Enviar documentos"
    │<──────────────────────────┤                                │
    │ 14. visualiza / baixa     │  link assinado de 2 min        │
    │ 15. aprova ou rejeita     │                                │
    ├──────────────────────────>│ ──────── socket.io ──────────> │ 16. vê o status mudar
    │ 17. disponibiliza arquivo │                                │     e o motivo da rejeição
    ├──────────────────────────>│ ──────── socket.io ──────────> │ 18. baixa o comprovante
    │ 19. encerra a sessão      │                                │
    ├──────────────────────────>│ token revogado, sessão fechada │ 20. portal bloqueado
```

### Ciclo de vida da sessão

```
AGUARDANDO ──(1º acesso)──> ACESSADA ──(1º anexo)──> EM_ANDAMENTO
                                                          │
                                        (envio completo)  ▼
     CANCELADA <──(revogação)───────────────────────── EM_ANALISE
     EXPIRADA  <──(prazo)                                 │
                                           (encerramento) ▼
                                                     CONCLUIDA
```

### Ciclo de vida de cada documento

```
PENDENTE → ANEXADO → ENVIADO → EM_ANALISE → APROVADO
                                   │
                                   └──> REJEITADO → AGUARDANDO_NOVO_ENVIO → (ANEXADO)
```

---

## 4. Perfis de acesso

| Perfil | Escopo | Pode |
|---|---|---|
| **ADMIN** | Todas as unidades | Cadastros, usuários, catálogo, configurações, relatórios, auditoria |
| **SUPERVISOR** | Sua unidade | Acompanhar todas as sessões da unidade, relatórios da unidade, catálogo somente leitura |
| **ATENDENTE** | Suas próprias sessões | Criar sessão, receber, aprovar/rejeitar, disponibilizar arquivos, encerrar |
| **CIDADÃO** | Uma única sessão | Ver a lista da sua sessão, anexar, enviar, baixar o que o atendente liberou |

Regras aplicadas no servidor (não apenas na interface):

- atendente só lê/escreve sessões em que é o `atendente_id`;
- supervisor só alcança sessões da sua `unidade_id`;
- o JWT do cidadão carrega `sid` (id da sessão) e **nenhum** dado pessoal; toda rota
  do portal confere o `sid` contra o recurso solicitado;
- arquivo só é entregue ao cidadão se for `origem = ATENDENTE` ou enviado por ele
  naquela mesma sessão.

---

## 5. Principais riscos técnicos e de segurança

| # | Risco | Severidade | Mitigação implementada | Pendente para produção |
|---|---|---|---|---|
| 1 | Acesso à sessão de outro cidadão (IDOR) | Crítica | Token de 256 bits, `sid` no JWT, verificação de pertencimento em toda rota e em todo arquivo | Teste de intrusão independente |
| 2 | Vazamento de CPF em URL ou log | Crítica | URL só contém token opaco; CPF cifrado e mascarado; log sem corpo de requisição | Revisão dos logs de infraestrutura |
| 3 | Upload de arquivo malicioso | Alta | Extensão + MIME + *magic bytes*, limite de tamanho e quantidade, nome gerado, `Content-Disposition: attachment` | Antivírus (ICAP/ClamAV) na ingestão |
| 4 | Força bruta em código curto ou login | Alta | Rate limit por IP e por rota, bloqueio progressivo do usuário, código curto sem caracteres ambíguos | CAPTCHA institucional e WAF |
| 5 | Arquivo legível no disco ou no backup | Alta | AES-256-GCM por arquivo, chave fora do banco | KMS/HSM e rotação de chaves |
| 6 | Sessão reaproveitada após o atendimento | Média | Expiração configurável, revogação pelo atendente, status bloqueante | Rotina de expiração em cluster |
| 7 | Documento falsificado | Alta | Conferência humana obrigatória, status de aprovação, SHA-256 registrado | Integração com validação oficial (Fase 4) |
| 8 | Retenção indevida (LGPD) | Alta | Política de retenção configurável e descarte seguro | Parecer do encarregado de dados |
| 9 | Perda de conexão do celular no envio | Média | Envio por arquivo (não em lote), reconexão do socket, status reconciliado por consulta de reserva | Upload retomável para arquivos grandes |
| 10 | Ausência da API institucional de CPF | Média | Adaptador com implementação `demo` claramente rotulada | Contrato e credenciais do DETRAN/SC |

**Não** está implementado e depende de decisão institucional: SSO (gov.br / LDAP),
assinatura digital ICP-Brasil, antivírus, KMS e TLS com certificado oficial.

---

## 6. Tecnologias recomendadas (e usadas)

| Camada | Escolha | Por quê |
|---|---|---|
| Front-end | **Vite 6 + React 18 + TypeScript** | Build rápido, SPA leve, bom comportamento em celular |
| Estilo | **Tailwind CSS 3** | Identidade visual consistente e responsiva |
| Roteamento | React Router 6 | Três áreas isoladas por prefixo de rota |
| API | **Node 20 + Express 4 + TypeScript** | Ecossistema maduro, tipagem de ponta a ponta |
| Banco | **MySQL 8** (`mysql2`, SQL explícito) | Requisito do projeto; SQL parametrizado, sem ORM pesado |
| Tempo real | **Socket.IO 4** | Salas por sessão, reconexão e *fallback* automáticos |
| Validação | **Zod** | O mesmo esquema valida corpo, query e parâmetros |
| Segurança | Helmet, CORS restrito, express-rate-limit, bcrypt, JWT, AES-256-GCM | Requisitos do item 10 |
| Infra | **Docker Compose** (mysql, api, web/nginx, adminer) | Sobe em um comando, igual em dev e homologação |
| Testes | Node Test Runner + Supertest | Cobrem autorização e fluxo de sessão |

Para produção: MySQL gerenciado com réplica, storage S3/MinIO, Redis como adaptador
do Socket.IO (mais de uma instância de API) e observabilidade (os logs já saem em JSON).

---

## 7. Plano de desenvolvimento por etapas

| Fase | Entregas | Situação |
|---|---|---|
| **1 — MVP** | Login, catálogo de serviços e documentos, identificação do cidadão, criação de sessão, QR Code, portal do cidadão, upload, recebimento no painel | Implementada |
| **2 — Comunicação** | Aprovação e rejeição com motivo, solicitação de correção, orientações, tempo real nos dois sentidos, arquivos do atendente, download pelo cidadão | Implementada |
| **3 — Administração** | Unidades, guichês, usuários e permissões, catálogo, configurações, indicadores, auditoria | Núcleo implementado; exportação e relatórios avançados pendentes |
| **4 — Integrações** | Base institucional de cidadãos, sistemas internos, validação documental, SSO, KMS, antivírus | Adaptadores prontos, integrações a contratar |

### Sequência sugerida para a continuidade

1. Homologação com dados fictícios em uma unidade piloto.
2. Parecer das áreas de segurança da informação, proteção de dados e governança.
3. Substituição do adaptador `demo` pela API institucional de cidadãos.
4. Antivírus na ingestão e KMS para as chaves de cifra.
5. SSO institucional substituindo e-mail e senha.
6. Piloto presencial assistido, com medição do tempo médio de envio.
