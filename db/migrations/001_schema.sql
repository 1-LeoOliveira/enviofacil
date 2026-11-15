-- =====================================================================
-- Envio Fácil - DETRAN/SC
-- Migração 001 - Esquema inicial
-- MySQL 8 / InnoDB / utf8mb4
-- =====================================================================

CREATE TABLE IF NOT EXISTS unidades (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome          VARCHAR(140) NOT NULL,
  sigla         VARCHAR(20)  NOT NULL,
  cidade        VARCHAR(90)  NOT NULL,
  uf            CHAR(2)      NOT NULL DEFAULT 'SC',
  endereco      VARCHAR(200) NULL,
  ativo         TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_unidades_sigla (sigla)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS guiches (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  unidade_id     INT UNSIGNED NOT NULL,
  identificacao  VARCHAR(40)  NOT NULL,
  descricao      VARCHAR(140) NULL,
  ativo          TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_guiches_unidade_ident (unidade_id, identificacao),
  CONSTRAINT fk_guiches_unidade FOREIGN KEY (unidade_id) REFERENCES unidades (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS usuarios (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome               VARCHAR(140) NOT NULL,
  email              VARCHAR(160) NOT NULL,
  matricula          VARCHAR(40)  NULL,
  senha_hash         VARCHAR(100) NOT NULL,
  perfil             ENUM('ADMIN','SUPERVISOR','ATENDENTE') NOT NULL DEFAULT 'ATENDENTE',
  unidade_id         INT UNSIGNED NULL,
  guiche_id          INT UNSIGNED NULL,
  ativo              TINYINT(1)   NOT NULL DEFAULT 1,
  deve_trocar_senha  TINYINT(1)   NOT NULL DEFAULT 0,
  tentativas_falhas  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_ate      DATETIME     NULL,
  ultimo_login_em    DATETIME     NULL,
  criado_em          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email),
  KEY ix_usuarios_unidade (unidade_id),
  CONSTRAINT fk_usuarios_unidade FOREIGN KEY (unidade_id) REFERENCES unidades (id) ON DELETE RESTRICT,
  CONSTRAINT fk_usuarios_guiche  FOREIGN KEY (guiche_id)  REFERENCES guiches  (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tipos_atendimento (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo        VARCHAR(50)  NOT NULL,
  nome          VARCHAR(140) NOT NULL,
  descricao     VARCHAR(400) NULL,
  categoria     ENUM('VEICULO','HABILITACAO','ADMINISTRATIVO') NOT NULL DEFAULT 'ADMINISTRATIVO',
  ordem         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ativo         TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipos_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS documentos_exigidos (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo_atendimento_id  INT UNSIGNED NOT NULL,
  nome                 VARCHAR(140) NOT NULL,
  descricao            VARCHAR(400) NULL,
  obrigatorio          TINYINT(1)   NOT NULL DEFAULT 1,
  ordem                SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ativo                TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_docexig_tipo (tipo_atendimento_id, ordem),
  CONSTRAINT fk_docexig_tipo FOREIGN KEY (tipo_atendimento_id) REFERENCES tipos_atendimento (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Sessões digitais
-- O CPF não é armazenado em claro: HMAC para busca, AES-256-GCM para
-- exibição autorizada e versão mascarada para uso em tela.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessoes (
  id                   CHAR(36)     NOT NULL,
  -- Busca pelo hash; o token em claro nunca é gravado. A versão cifrada
  -- (AES-256-GCM, chave fora do banco) permite reexibir o QR ao atendente.
  token_hash           CHAR(64)     NOT NULL,
  token_cipher         VARBINARY(255) NOT NULL,
  codigo_curto         VARCHAR(12)  NOT NULL,
  cpf_hash             CHAR(64)     NOT NULL,
  cpf_cipher           VARBINARY(255) NOT NULL,
  cpf_mascarado        VARCHAR(20)  NOT NULL,
  cidadao_nome         VARCHAR(160) NOT NULL,
  origem_identificacao VARCHAR(40)  NOT NULL DEFAULT 'demo',
  tipo_atendimento_id  INT UNSIGNED NOT NULL,
  atendente_id         INT UNSIGNED NOT NULL,
  unidade_id           INT UNSIGNED NOT NULL,
  guiche_id            INT UNSIGNED NULL,
  status               ENUM('AGUARDANDO','ACESSADA','EM_ANDAMENTO','EM_ANALISE','CONCLUIDA','EXPIRADA','CANCELADA')
                       NOT NULL DEFAULT 'AGUARDANDO',
  observacoes          VARCHAR(600) NULL,
  motivo_encerramento  VARCHAR(300) NULL,
  criado_em            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em            DATETIME     NOT NULL,
  primeiro_acesso_em   DATETIME     NULL,
  enviado_em           DATETIME     NULL,
  encerrado_em         DATETIME     NULL,
  atualizado_em        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessoes_token (token_hash),
  UNIQUE KEY uq_sessoes_codigo (codigo_curto),
  KEY ix_sessoes_atendente (atendente_id, status),
  KEY ix_sessoes_unidade (unidade_id, criado_em),
  KEY ix_sessoes_cpf (cpf_hash),
  KEY ix_sessoes_expira (status, expira_em),
  CONSTRAINT fk_sessoes_tipo      FOREIGN KEY (tipo_atendimento_id) REFERENCES tipos_atendimento (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sessoes_atendente FOREIGN KEY (atendente_id) REFERENCES usuarios (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sessoes_unidade   FOREIGN KEY (unidade_id)   REFERENCES unidades (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sessoes_guiche    FOREIGN KEY (guiche_id)    REFERENCES guiches (id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessao_documentos (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sessao_id              CHAR(36)     NOT NULL,
  documento_exigido_id   INT UNSIGNED NULL,
  nome                   VARCHAR(140) NOT NULL,
  descricao              VARCHAR(400) NULL,
  obrigatorio            TINYINT(1)   NOT NULL DEFAULT 1,
  ordem                  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  status                 ENUM('PENDENTE','ANEXADO','ENVIADO','EM_ANALISE','APROVADO','REJEITADO','AGUARDANDO_NOVO_ENVIO')
                         NOT NULL DEFAULT 'PENDENTE',
  motivo_rejeicao        VARCHAR(400) NULL,
  orientacao             VARCHAR(400) NULL,
  analisado_por          INT UNSIGNED NULL,
  analisado_em           DATETIME     NULL,
  criado_em              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_sessaodoc_sessao (sessao_id, ordem),
  CONSTRAINT fk_sessaodoc_sessao   FOREIGN KEY (sessao_id) REFERENCES sessoes (id) ON DELETE CASCADE,
  CONSTRAINT fk_sessaodoc_exigido  FOREIGN KEY (documento_exigido_id) REFERENCES documentos_exigidos (id) ON DELETE SET NULL,
  CONSTRAINT fk_sessaodoc_analista FOREIGN KEY (analisado_por) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Arquivos nos dois sentidos (cidadão -> atendente e atendente -> cidadão).
-- Conteúdo cifrado em repouso: IV e auth tag ficam aqui, a chave fica fora do banco.
CREATE TABLE IF NOT EXISTS arquivos (
  id                   CHAR(36)     NOT NULL,
  sessao_id            CHAR(36)     NOT NULL,
  sessao_documento_id  INT UNSIGNED NULL,
  origem               ENUM('CIDADAO','ATENDENTE') NOT NULL,
  titulo               VARCHAR(140) NULL,
  descricao            VARCHAR(400) NULL,
  nome_original        VARCHAR(255) NOT NULL,
  chave_armazenamento  VARCHAR(255) NOT NULL,
  mime                 VARCHAR(100) NOT NULL,
  tamanho_bytes        INT UNSIGNED NOT NULL,
  sha256               CHAR(64)     NOT NULL,
  cifra_iv             VARBINARY(16) NOT NULL,
  cifra_tag            VARBINARY(16) NOT NULL,
  enviado_em           DATETIME     NULL,
  criado_em            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por_usuario   INT UNSIGNED NULL,
  substituido          TINYINT(1)   NOT NULL DEFAULT 0,
  excluido_em          DATETIME     NULL,
  PRIMARY KEY (id),
  KEY ix_arquivos_sessao (sessao_id, origem),
  KEY ix_arquivos_documento (sessao_documento_id, substituido),
  CONSTRAINT fk_arquivos_sessao    FOREIGN KEY (sessao_id) REFERENCES sessoes (id) ON DELETE CASCADE,
  CONSTRAINT fk_arquivos_documento FOREIGN KEY (sessao_documento_id) REFERENCES sessao_documentos (id) ON DELETE CASCADE,
  CONSTRAINT fk_arquivos_usuario   FOREIGN KEY (criado_por_usuario) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS eventos_sessao (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sessao_id  CHAR(36)     NOT NULL,
  tipo       VARCHAR(60)  NOT NULL,
  ator       ENUM('CIDADAO','ATENDENTE','SISTEMA') NOT NULL,
  usuario_id INT UNSIGNED NULL,
  mensagem   VARCHAR(400) NULL,
  dados      JSON         NULL,
  criado_em  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_eventos_sessao (sessao_id, id),
  CONSTRAINT fk_eventos_sessao FOREIGN KEY (sessao_id) REFERENCES sessoes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auditoria (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id  INT UNSIGNED NULL,
  ator        VARCHAR(40)  NOT NULL DEFAULT 'SISTEMA',
  acao        VARCHAR(80)  NOT NULL,
  entidade    VARCHAR(60)  NOT NULL,
  entidade_id VARCHAR(60)  NULL,
  resultado   ENUM('SUCESSO','FALHA') NOT NULL DEFAULT 'SUCESSO',
  ip          VARCHAR(60)  NULL,
  user_agent  VARCHAR(255) NULL,
  detalhes    JSON         NULL,
  criado_em   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_auditoria_usuario (usuario_id, criado_em),
  KEY ix_auditoria_entidade (entidade, entidade_id),
  KEY ix_auditoria_data (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS configuracoes (
  chave         VARCHAR(80)  NOT NULL,
  valor         VARCHAR(255) NOT NULL,
  tipo          ENUM('INTEIRO','TEXTO','BOOLEANO','LISTA') NOT NULL DEFAULT 'TEXTO',
  descricao     VARCHAR(255) NULL,
  grupo         VARCHAR(40)  NOT NULL DEFAULT 'GERAL',
  atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  atualizado_por INT UNSIGNED NULL,
  PRIMARY KEY (chave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- AMBIENTE DE DEMONSTRAÇÃO
-- Base fictícia usada somente quando CIDADAO_PROVIDER=demo.
-- Não representa dados reais de cidadãos e deve ser removida antes de
-- qualquer uso em produção, quando entra a integração institucional.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo_cidadaos (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cpf_hash      CHAR(64)     NOT NULL,
  cpf           VARCHAR(14)  NOT NULL,
  nome          VARCHAR(160) NOT NULL,
  nascimento    DATE         NULL,
  ambiente      VARCHAR(20)  NOT NULL DEFAULT 'DEMONSTRACAO',
  PRIMARY KEY (id),
  UNIQUE KEY uq_democidadaos_hash (cpf_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
