import bcrypt from 'bcryptjs';
import { consultarUm, executar, type RowDataPacket } from './pool';
import { hmacCpf, somenteDigitos } from '../lib/crypto';
import { log } from '../lib/logger';

interface LinhaId extends RowDataPacket {
  id: number;
}

/**
 * Carga inicial: parâmetros operacionais, catálogo de serviços, unidades,
 * guichês e usuários de demonstração.
 *
 * A base de cidadãos (`demo_cidadaos`) é FICTÍCIA e existe apenas para o
 * ambiente de demonstração, enquanto a integração institucional não estiver
 * disponível (ver api/src/integrations/cidadaos).
 */

const CONFIGURACOES: Array<[string, string, 'INTEIRO' | 'TEXTO' | 'BOOLEANO' | 'LISTA', string, string]> = [
  ['sessao_ttl_minutos', '60', 'INTEIRO', 'Validade da sessão digital, em minutos', 'SESSAO'],
  ['sessao_prorrogacao_minutos', '30', 'INTEIRO', 'Minutos adicionados a cada prorrogação', 'SESSAO'],
  ['upload_tamanho_maximo_mb', '10', 'INTEIRO', 'Tamanho máximo por arquivo, em MB', 'ARQUIVOS'],
  ['upload_max_arquivos_documento', '3', 'INTEIRO', 'Arquivos por documento solicitado', 'ARQUIVOS'],
  ['upload_max_arquivos_sessao', '30', 'INTEIRO', 'Total de arquivos por sessão', 'ARQUIVOS'],
  ['upload_formatos_permitidos', 'pdf,jpg,jpeg,png', 'LISTA', 'Extensões aceitas no envio', 'ARQUIVOS'],
  ['retencao_arquivos_dias', '30', 'INTEIRO', 'Dias de retenção dos arquivos após o encerramento', 'LGPD'],
  ['atendente_pode_adicionar_documento', 'true', 'BOOLEANO', 'Permite incluir documento extra na sessão', 'ATENDIMENTO'],
  ['aviso_ambiente_demonstracao', 'true', 'BOOLEANO', 'Exibe o aviso de ambiente de demonstração', 'GERAL'],
];

const SERVICOS: Array<{
  codigo: string;
  nome: string;
  descricao: string;
  categoria: 'VEICULO' | 'HABILITACAO' | 'ADMINISTRATIVO';
  documentos: Array<{ nome: string; descricao: string; obrigatorio: boolean }>;
}> = [
  {
    codigo: 'TRANSFERENCIA_PROPRIEDADE',
    nome: 'Transferência de propriedade de veículo',
    descricao: 'Mudança de titularidade do veículo entre comprador e vendedor.',
    categoria: 'VEICULO',
    documentos: [
      { nome: 'Laudo de vistoria', descricao: 'Laudo emitido por empresa credenciada, dentro da validade.', obrigatorio: true },
      { nome: 'CRLV ou documento do veículo', descricao: 'Documento do veículo digital ou foto legível do documento impresso.', obrigatorio: true },
      { nome: 'CNH do responsável', descricao: 'CNH Digital ou foto da CNH física, frente e verso legíveis.', obrigatorio: true },
      { nome: 'Comprovante de residência', descricao: 'Conta de água, luz ou telefone dos últimos 90 dias.', obrigatorio: true },
      { nome: 'Comprovante de pagamento das taxas', descricao: 'Guia paga referente ao serviço.', obrigatorio: false },
    ],
  },
  {
    codigo: 'PRIMEIRO_EMPLACAMENTO',
    nome: 'Primeiro emplacamento',
    descricao: 'Registro inicial de veículo novo e emissão da primeira placa.',
    categoria: 'VEICULO',
    documentos: [
      { nome: 'Nota fiscal do veículo', descricao: 'Nota fiscal de venda emitida pela concessionária.', obrigatorio: true },
      { nome: 'Documento de identificação com foto', descricao: 'RG, CNH ou outro documento oficial com foto.', obrigatorio: true },
      { nome: 'Comprovante de residência', descricao: 'Emitido nos últimos 90 dias.', obrigatorio: true },
      { nome: 'Comprovante de pagamento das taxas', descricao: 'Guia de recolhimento quitada.', obrigatorio: true },
    ],
  },
  {
    codigo: 'SEGUNDA_VIA_DOCUMENTOS',
    nome: 'Segunda via de documentos',
    descricao: 'Emissão de nova via do documento do veículo ou da habilitação.',
    categoria: 'ADMINISTRATIVO',
    documentos: [
      { nome: 'Documento de identificação com foto', descricao: 'RG, CNH ou documento oficial equivalente.', obrigatorio: true },
      { nome: 'Comprovante de residência', descricao: 'Emitido nos últimos 90 dias.', obrigatorio: true },
      { nome: 'Boletim de ocorrência', descricao: 'Necessário em caso de furto, roubo ou extravio.', obrigatorio: false },
    ],
  },
  {
    codigo: 'ALTERACAO_CARACTERISTICAS',
    nome: 'Alteração de características do veículo',
    descricao: 'Registro de modificações como cor, motor, combustível ou carroceria.',
    categoria: 'VEICULO',
    documentos: [
      { nome: 'CRLV ou documento do veículo', descricao: 'Documento atual do veículo.', obrigatorio: true },
      { nome: 'Laudo técnico da alteração', descricao: 'Laudo de entidade credenciada referente à modificação.', obrigatorio: true },
      { nome: 'Nota fiscal da peça ou serviço', descricao: 'Comprovação da origem do componente instalado.', obrigatorio: true },
      { nome: 'CNH do responsável', descricao: 'CNH Digital ou foto da CNH física.', obrigatorio: true },
    ],
  },
  {
    codigo: 'REGULARIZACAO_VEICULO',
    nome: 'Regularização de veículo',
    descricao: 'Acerto de pendências administrativas do veículo.',
    categoria: 'VEICULO',
    documentos: [
      { nome: 'CRLV ou documento do veículo', descricao: 'Documento atual do veículo.', obrigatorio: true },
      { nome: 'Documento de identificação com foto', descricao: 'Documento oficial do proprietário ou procurador.', obrigatorio: true },
      { nome: 'Comprovantes de pagamento de débitos', descricao: 'Comprovantes de IPVA, licenciamento ou multas quitadas.', obrigatorio: true },
      { nome: 'Procuração', descricao: 'Obrigatória quando o solicitante não é o proprietário.', obrigatorio: false },
    ],
  },
  {
    codigo: 'HABILITACAO_RENOVACAO',
    nome: 'Serviços relacionados à habilitação',
    descricao: 'Renovação, adição de categoria e demais serviços de CNH.',
    categoria: 'HABILITACAO',
    documentos: [
      { nome: 'CNH atual', descricao: 'CNH Digital ou foto da CNH física, frente e verso.', obrigatorio: true },
      { nome: 'Documento de identificação com foto', descricao: 'RG ou documento oficial equivalente.', obrigatorio: true },
      { nome: 'Comprovante de residência', descricao: 'Emitido nos últimos 90 dias.', obrigatorio: true },
      { nome: 'Exame médico ou laudo', descricao: 'Quando exigido pelo serviço solicitado.', obrigatorio: false },
    ],
  },
  {
    codigo: 'OUTROS_SERVICOS',
    nome: 'Outros serviços administrativos',
    descricao: 'Demandas administrativas diversas com documentação definida no guichê.',
    categoria: 'ADMINISTRATIVO',
    documentos: [
      { nome: 'Documento de identificação com foto', descricao: 'Documento oficial com foto.', obrigatorio: true },
      { nome: 'Requerimento ou petição', descricao: 'Documento que descreve a solicitação.', obrigatorio: false },
    ],
  },
];

const CIDADAOS_DEMO: Array<{ cpf: string; nome: string; nascimento: string }> = [
  { cpf: '529.982.247-25', nome: 'Maria Aparecida da Silva', nascimento: '1985-04-12' },
  { cpf: '111.444.777-35', nome: 'João Pedro Oliveira', nascimento: '1992-09-30' },
  { cpf: '390.533.447-05', nome: 'Ana Carolina Schmitt', nascimento: '1978-01-22' },
  { cpf: '123.456.789-09', nome: 'Carlos Eduardo Berg', nascimento: '1999-11-05' },
  { cpf: '987.654.321-00', nome: 'Luciana Hoffmann Costa', nascimento: '1969-07-17' },
];

export async function semear(opcoes: { demo: boolean }): Promise<void> {
  for (const [chave, valor, tipo, descricao, grupo] of CONFIGURACOES) {
    await executar(
      `INSERT INTO configuracoes (chave, valor, tipo, descricao, grupo)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE descricao = VALUES(descricao), grupo = VALUES(grupo), tipo = VALUES(tipo)`,
      [chave, valor, tipo, descricao, grupo],
    );
  }
  log.info('Configurações padrão garantidas');

  for (const [indice, servico] of SERVICOS.entries()) {
    await executar(
      `INSERT INTO tipos_atendimento (codigo, nome, descricao, categoria, ordem)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE nome = VALUES(nome), descricao = VALUES(descricao)`,
      [servico.codigo, servico.nome, servico.descricao, servico.categoria, indice * 10],
    );
    const tipo = await consultarUm<LinhaId>('SELECT id FROM tipos_atendimento WHERE codigo = ?', [
      servico.codigo,
    ]);
    if (!tipo) continue;

    const existentes = await consultarUm<RowDataPacket & { total: number }>(
      'SELECT COUNT(*) AS total FROM documentos_exigidos WHERE tipo_atendimento_id = ?',
      [tipo.id],
    );
    if (existentes && Number(existentes.total) > 0) continue;

    for (const [i, doc] of servico.documentos.entries()) {
      await executar(
        `INSERT INTO documentos_exigidos (tipo_atendimento_id, nome, descricao, obrigatorio, ordem)
         VALUES (?, ?, ?, ?, ?)`,
        [tipo.id, doc.nome, doc.descricao, doc.obrigatorio ? 1 : 0, i * 10],
      );
    }
  }
  log.info('Catálogo de serviços garantido', { servicos: SERVICOS.length });

  if (!opcoes.demo) {
    log.info('SEED_DEMO desativado: unidades, usuários e cidadãos fictícios não foram criados');
    return;
  }

  // ------------------------------------------------- unidades e guichês (demo)
  const unidades = [
    { nome: 'CIRETRAN Florianópolis', sigla: 'FLN', cidade: 'Florianópolis', endereco: 'Rua Principal, 100 - Centro' },
    { nome: 'CIRETRAN Joinville', sigla: 'JOI', cidade: 'Joinville', endereco: 'Av. das Palmeiras, 2500' },
  ];
  for (const u of unidades) {
    await executar(
      `INSERT INTO unidades (nome, sigla, cidade, uf, endereco)
       VALUES (?, ?, ?, 'SC', ?)
       ON DUPLICATE KEY UPDATE nome = VALUES(nome), cidade = VALUES(cidade)`,
      [u.nome, u.sigla, u.cidade, u.endereco],
    );
  }
  const unidadeFln = await consultarUm<LinhaId>('SELECT id FROM unidades WHERE sigla = ?', ['FLN']);
  const unidadeJoi = await consultarUm<LinhaId>('SELECT id FROM unidades WHERE sigla = ?', ['JOI']);
  if (!unidadeFln || !unidadeJoi) throw new Error('Falha ao criar unidades de demonstração.');

  for (const [unidadeId, guiches] of [
    [unidadeFln.id, ['Guichê 01', 'Guichê 02', 'Guichê 03']],
    [unidadeJoi.id, ['Guichê 01', 'Guichê 02']],
  ] as Array<[number, string[]]>) {
    for (const identificacao of guiches) {
      await executar(
        `INSERT INTO guiches (unidade_id, identificacao)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE ativo = 1`,
        [unidadeId, identificacao],
      );
    }
  }

  const guicheFln1 = await consultarUm<LinhaId>(
    'SELECT id FROM guiches WHERE unidade_id = ? AND identificacao = ?',
    [unidadeFln.id, 'Guichê 01'],
  );

  // --------------------------------------------------------- usuários (demo)
  const usuarios = [
    {
      nome: 'Administrador do Sistema',
      email: 'admin@enviofacil.sc.gov.br',
      senha: 'Admin@2025',
      perfil: 'ADMIN' as const,
      unidade_id: unidadeFln.id,
      guiche_id: null as number | null,
      matricula: 'ADM-0001',
    },
    {
      nome: 'Regina Martins',
      email: 'supervisor@enviofacil.sc.gov.br',
      senha: 'Super@2025',
      perfil: 'SUPERVISOR' as const,
      unidade_id: unidadeFln.id,
      guiche_id: null,
      matricula: 'SUP-0007',
    },
    {
      nome: 'Bruno Teixeira',
      email: 'atendente@enviofacil.sc.gov.br',
      senha: 'Atende@2025',
      perfil: 'ATENDENTE' as const,
      unidade_id: unidadeFln.id,
      guiche_id: guicheFln1?.id ?? null,
      matricula: 'ATD-0042',
    },
  ];

  for (const u of usuarios) {
    const hash = await bcrypt.hash(u.senha, 10);
    await executar(
      `INSERT INTO usuarios (nome, email, matricula, senha_hash, perfil, unidade_id, guiche_id, ativo)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE nome = VALUES(nome), perfil = VALUES(perfil),
         unidade_id = VALUES(unidade_id), guiche_id = VALUES(guiche_id), ativo = 1`,
      [u.nome, u.email, u.matricula, hash, u.perfil, u.unidade_id, u.guiche_id],
    );
  }
  log.info('Usuários de demonstração garantidos', { usuarios: usuarios.map((u) => u.email) });

  // ------------------------------------------- base FICTÍCIA de cidadãos
  for (const c of CIDADAOS_DEMO) {
    await executar(
      `INSERT INTO demo_cidadaos (cpf_hash, cpf, nome, nascimento, ambiente)
       VALUES (?, ?, ?, ?, 'DEMONSTRACAO')
       ON DUPLICATE KEY UPDATE nome = VALUES(nome), nascimento = VALUES(nascimento)`,
      [hmacCpf(c.cpf), somenteDigitos(c.cpf), c.nome, c.nascimento],
    );
  }
  log.info('Base fictícia de cidadãos (DEMONSTRAÇÃO) garantida', { registros: CIDADAOS_DEMO.length });
}

export const CPFS_DEMONSTRACAO = CIDADAOS_DEMO.map((c) => c.cpf);
