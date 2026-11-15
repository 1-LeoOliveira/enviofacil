import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { consultar, consultarUm, executar, type RowDataPacket } from '../../db/pool';
import { auditar } from '../../lib/auditoria';
import { assincrono, erros } from '../../lib/errors';
import { atualizarParametro, listarParametros } from '../../lib/parametros';
import { offsetSql } from '../../lib/datas';
import { exigirPerfil, exigirServidor } from '../../middleware/auth';
import { validar } from '../../middleware/validar';

export const rotasAdmin = Router();
rotasAdmin.use(exigirServidor);

const somenteAdmin = exigirPerfil('ADMIN');
const esquemaIdNumerico = z.object({ id: z.coerce.number().int().positive() });

// ------------------------------------------------------------------- unidades

const esquemaUnidade = z.object({
  nome: z.string().trim().min(3).max(140),
  sigla: z.string().trim().min(2).max(20).toUpperCase(),
  cidade: z.string().trim().min(2).max(90),
  uf: z.string().trim().length(2).toUpperCase().default('SC'),
  endereco: z.string().trim().max(200).optional(),
  ativo: z.boolean().default(true),
});

rotasAdmin.get(
  '/unidades',
  assincrono(async (_req, res) => {
    const unidades = await consultar<RowDataPacket>(
      `SELECT u.id, u.nome, u.sigla, u.cidade, u.uf, u.endereco, u.ativo,
              (SELECT COUNT(*) FROM guiches g WHERE g.unidade_id = u.id AND g.ativo = 1) AS guiches,
              (SELECT COUNT(*) FROM usuarios us WHERE us.unidade_id = u.id AND us.ativo = 1) AS usuarios
         FROM unidades u ORDER BY u.nome`,
    );
    res.json({ unidades });
  }),
);

rotasAdmin.post(
  '/unidades',
  somenteAdmin,
  validar(esquemaUnidade),
  assincrono(async (req, res) => {
    const d = req.body as z.infer<typeof esquemaUnidade>;
    const resultado = await executar(
      'INSERT INTO unidades (nome, sigla, cidade, uf, endereco, ativo) VALUES (?, ?, ?, ?, ?, ?)',
      [d.nome, d.sigla, d.cidade, d.uf, d.endereco ?? null, d.ativo ? 1 : 0],
    );
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'UNIDADE_CRIADA',
      entidade: 'unidades',
      entidadeId: resultado.insertId,
      detalhes: { sigla: d.sigla },
    });
    res.status(201).json({ id: resultado.insertId });
  }),
);

rotasAdmin.put(
  '/unidades/:id',
  somenteAdmin,
  validar(esquemaIdNumerico, 'params'),
  validar(esquemaUnidade),
  assincrono(async (req, res) => {
    const d = req.body as z.infer<typeof esquemaUnidade>;
    const resultado = await executar(
      'UPDATE unidades SET nome = ?, sigla = ?, cidade = ?, uf = ?, endereco = ?, ativo = ? WHERE id = ?',
      [d.nome, d.sigla, d.cidade, d.uf, d.endereco ?? null, d.ativo ? 1 : 0, req.params.id],
    );
    if (!resultado.affectedRows) throw erros.naoEncontrado('Unidade não encontrada.');
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'UNIDADE_ATUALIZADA',
      entidade: 'unidades',
      entidadeId: req.params.id,
    });
    res.json({ mensagem: 'Unidade atualizada.' });
  }),
);

// -------------------------------------------------------------------- guichês

const esquemaGuiche = z.object({
  unidadeId: z.coerce.number().int().positive(),
  identificacao: z.string().trim().min(2).max(40),
  descricao: z.string().trim().max(140).optional(),
  ativo: z.boolean().default(true),
});

rotasAdmin.get(
  '/guiches',
  assincrono(async (req, res) => {
    const unidadeId = req.query.unidadeId ? Number(req.query.unidadeId) : null;
    const guiches = await consultar<RowDataPacket>(
      `SELECT g.id, g.unidade_id, g.identificacao, g.descricao, g.ativo, u.nome AS unidade_nome,
              (SELECT COUNT(*) FROM usuarios us WHERE us.guiche_id = g.id AND us.ativo = 1) AS atendentes
         FROM guiches g JOIN unidades u ON u.id = g.unidade_id
        ${unidadeId ? 'WHERE g.unidade_id = ?' : ''}
        ORDER BY u.nome, g.identificacao`,
      unidadeId ? [unidadeId] : [],
    );
    res.json({ guiches });
  }),
);

rotasAdmin.post(
  '/guiches',
  somenteAdmin,
  validar(esquemaGuiche),
  assincrono(async (req, res) => {
    const d = req.body as z.infer<typeof esquemaGuiche>;
    const resultado = await executar(
      'INSERT INTO guiches (unidade_id, identificacao, descricao, ativo) VALUES (?, ?, ?, ?)',
      [d.unidadeId, d.identificacao, d.descricao ?? null, d.ativo ? 1 : 0],
    );
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'GUICHE_CRIADO',
      entidade: 'guiches',
      entidadeId: resultado.insertId,
    });
    res.status(201).json({ id: resultado.insertId });
  }),
);

rotasAdmin.put(
  '/guiches/:id',
  somenteAdmin,
  validar(esquemaIdNumerico, 'params'),
  validar(esquemaGuiche),
  assincrono(async (req, res) => {
    const d = req.body as z.infer<typeof esquemaGuiche>;
    const resultado = await executar(
      'UPDATE guiches SET unidade_id = ?, identificacao = ?, descricao = ?, ativo = ? WHERE id = ?',
      [d.unidadeId, d.identificacao, d.descricao ?? null, d.ativo ? 1 : 0, req.params.id],
    );
    if (!resultado.affectedRows) throw erros.naoEncontrado('Guichê não encontrado.');
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'GUICHE_ATUALIZADO',
      entidade: 'guiches',
      entidadeId: req.params.id,
    });
    res.json({ mensagem: 'Guichê atualizado.' });
  }),
);

// ------------------------------------------------------------------- usuários

const esquemaUsuario = z.object({
  nome: z.string().trim().min(3).max(140),
  email: z.string().trim().email().max(160).toLowerCase(),
  matricula: z.string().trim().max(40).optional(),
  perfil: z.enum(['ADMIN', 'SUPERVISOR', 'ATENDENTE']),
  unidadeId: z.coerce.number().int().positive().nullable().optional(),
  guicheId: z.coerce.number().int().positive().nullable().optional(),
  ativo: z.boolean().default(true),
});

const esquemaUsuarioNovo = esquemaUsuario.extend({
  senha: z
    .string()
    .min(10, 'A senha provisória deve ter ao menos 10 caracteres.')
    .max(200)
    .refine((s) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s), {
      message: 'A senha deve conter letras maiúsculas, minúsculas e números.',
    }),
});

rotasAdmin.get(
  '/usuarios',
  somenteAdmin,
  assincrono(async (req, res) => {
    const unidadeId = req.query.unidadeId ? Number(req.query.unidadeId) : null;
    const usuarios = await consultar<RowDataPacket>(
      `SELECT u.id, u.nome, u.email, u.matricula, u.perfil, u.unidade_id, u.guiche_id, u.ativo,
              u.ultimo_login_em, u.bloqueado_ate, un.nome AS unidade_nome, g.identificacao AS guiche_identificacao
         FROM usuarios u
         LEFT JOIN unidades un ON un.id = u.unidade_id
         LEFT JOIN guiches g ON g.id = u.guiche_id
        ${unidadeId ? 'WHERE u.unidade_id = ?' : ''}
        ORDER BY u.nome`,
      unidadeId ? [unidadeId] : [],
    );
    res.json({ usuarios });
  }),
);

async function validarVinculo(unidadeId: number | null | undefined, guicheId: number | null | undefined) {
  if (guicheId) {
    if (!unidadeId) throw erros.invalido('Informe a unidade do guichê.');
    const guiche = await consultarUm<RowDataPacket & { id: number }>(
      'SELECT id FROM guiches WHERE id = ? AND unidade_id = ?',
      [guicheId, unidadeId],
    );
    if (!guiche) throw erros.invalido('O guichê informado não pertence à unidade selecionada.');
  }
}

rotasAdmin.post(
  '/usuarios',
  somenteAdmin,
  validar(esquemaUsuarioNovo),
  assincrono(async (req, res) => {
    const d = req.body as z.infer<typeof esquemaUsuarioNovo>;
    await validarVinculo(d.unidadeId, d.guicheId);

    const resultado = await executar(
      `INSERT INTO usuarios (nome, email, matricula, senha_hash, perfil, unidade_id, guiche_id, ativo, deve_trocar_senha)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        d.nome,
        d.email,
        d.matricula ?? null,
        await bcrypt.hash(d.senha, 10),
        d.perfil,
        d.unidadeId ?? null,
        d.guicheId ?? null,
        d.ativo ? 1 : 0,
      ],
    );
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'USUARIO_CRIADO',
      entidade: 'usuarios',
      entidadeId: resultado.insertId,
      detalhes: { perfil: d.perfil },
    });
    res.status(201).json({ id: resultado.insertId });
  }),
);

rotasAdmin.put(
  '/usuarios/:id',
  somenteAdmin,
  validar(esquemaIdNumerico, 'params'),
  validar(esquemaUsuario),
  assincrono(async (req, res) => {
    const d = req.body as z.infer<typeof esquemaUsuario>;
    const id = Number(req.params.id);
    await validarVinculo(d.unidadeId, d.guicheId);

    // Evita que o próprio administrador se desative ou perca o perfil por engano.
    if (id === req.usuario!.id && (!d.ativo || d.perfil !== 'ADMIN')) {
      throw erros.conflito('Você não pode remover o seu próprio acesso de administrador.');
    }

    const resultado = await executar(
      `UPDATE usuarios SET nome = ?, email = ?, matricula = ?, perfil = ?, unidade_id = ?, guiche_id = ?, ativo = ?
        WHERE id = ?`,
      [
        d.nome,
        d.email,
        d.matricula ?? null,
        d.perfil,
        d.unidadeId ?? null,
        d.guicheId ?? null,
        d.ativo ? 1 : 0,
        id,
      ],
    );
    if (!resultado.affectedRows) throw erros.naoEncontrado('Usuário não encontrado.');
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'USUARIO_ATUALIZADO',
      entidade: 'usuarios',
      entidadeId: id,
    });
    res.json({ mensagem: 'Usuário atualizado.' });
  }),
);

rotasAdmin.post(
  '/usuarios/:id/senha',
  somenteAdmin,
  validar(esquemaIdNumerico, 'params'),
  validar(z.object({ senha: esquemaUsuarioNovo.shape.senha })),
  assincrono(async (req, res) => {
    const { senha } = req.body as { senha: string };
    const resultado = await executar(
      `UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 1, tentativas_falhas = 0, bloqueado_ate = NULL
        WHERE id = ?`,
      [await bcrypt.hash(senha, 10), req.params.id],
    );
    if (!resultado.affectedRows) throw erros.naoEncontrado('Usuário não encontrado.');
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'SENHA_REDEFINIDA',
      entidade: 'usuarios',
      entidadeId: req.params.id,
    });
    res.json({ mensagem: 'Senha provisória definida. O usuário deverá trocá-la no próximo acesso.' });
  }),
);

// -------------------------------------------------------- tipos de atendimento

const esquemaTipo = z.object({
  codigo: z.string().trim().min(3).max(50).toUpperCase().regex(/^[A-Z0-9_]+$/, 'Use letras, números e underscore.'),
  nome: z.string().trim().min(3).max(140),
  descricao: z.string().trim().max(400).optional(),
  categoria: z.enum(['VEICULO', 'HABILITACAO', 'ADMINISTRATIVO']),
  ordem: z.coerce.number().int().min(0).max(9999).default(0),
  ativo: z.boolean().default(true),
});

rotasAdmin.get(
  '/tipos-atendimento',
  assincrono(async (_req, res) => {
    const tipos = await consultar<RowDataPacket>(
      `SELECT t.id, t.codigo, t.nome, t.descricao, t.categoria, t.ordem, t.ativo,
              (SELECT COUNT(*) FROM documentos_exigidos d WHERE d.tipo_atendimento_id = t.id AND d.ativo = 1) AS documentos,
              (SELECT COUNT(*) FROM sessoes s WHERE s.tipo_atendimento_id = t.id) AS sessoes
         FROM tipos_atendimento t ORDER BY t.ordem, t.nome`,
    );
    res.json({ tipos });
  }),
);

rotasAdmin.post(
  '/tipos-atendimento',
  somenteAdmin,
  validar(esquemaTipo),
  assincrono(async (req, res) => {
    const d = req.body as z.infer<typeof esquemaTipo>;
    const resultado = await executar(
      'INSERT INTO tipos_atendimento (codigo, nome, descricao, categoria, ordem, ativo) VALUES (?, ?, ?, ?, ?, ?)',
      [d.codigo, d.nome, d.descricao ?? null, d.categoria, d.ordem, d.ativo ? 1 : 0],
    );
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'SERVICO_CRIADO',
      entidade: 'tipos_atendimento',
      entidadeId: resultado.insertId,
      detalhes: { codigo: d.codigo },
    });
    res.status(201).json({ id: resultado.insertId });
  }),
);

rotasAdmin.put(
  '/tipos-atendimento/:id',
  somenteAdmin,
  validar(esquemaIdNumerico, 'params'),
  validar(esquemaTipo),
  assincrono(async (req, res) => {
    const d = req.body as z.infer<typeof esquemaTipo>;
    const resultado = await executar(
      'UPDATE tipos_atendimento SET codigo = ?, nome = ?, descricao = ?, categoria = ?, ordem = ?, ativo = ? WHERE id = ?',
      [d.codigo, d.nome, d.descricao ?? null, d.categoria, d.ordem, d.ativo ? 1 : 0, req.params.id],
    );
    if (!resultado.affectedRows) throw erros.naoEncontrado('Serviço não encontrado.');
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'SERVICO_ATUALIZADO',
      entidade: 'tipos_atendimento',
      entidadeId: req.params.id,
    });
    res.json({ mensagem: 'Serviço atualizado.' });
  }),
);

// --------------------------------------------------- documentos de um serviço

const esquemaDocumentoExigido = z.object({
  nome: z.string().trim().min(3).max(140),
  descricao: z.string().trim().max(400).optional(),
  obrigatorio: z.boolean().default(true),
  ordem: z.coerce.number().int().min(0).max(9999).default(0),
  ativo: z.boolean().default(true),
});

rotasAdmin.get(
  '/tipos-atendimento/:id/documentos',
  validar(esquemaIdNumerico, 'params'),
  assincrono(async (req, res) => {
    const documentos = await consultar<RowDataPacket>(
      `SELECT id, nome, descricao, obrigatorio, ordem, ativo
         FROM documentos_exigidos WHERE tipo_atendimento_id = ? ORDER BY ordem, id`,
      [req.params.id],
    );
    res.json({ documentos });
  }),
);

rotasAdmin.post(
  '/tipos-atendimento/:id/documentos',
  somenteAdmin,
  validar(esquemaIdNumerico, 'params'),
  validar(esquemaDocumentoExigido),
  assincrono(async (req, res) => {
    const d = req.body as z.infer<typeof esquemaDocumentoExigido>;
    const tipo = await consultarUm<RowDataPacket & { id: number }>(
      'SELECT id FROM tipos_atendimento WHERE id = ?',
      [req.params.id],
    );
    if (!tipo) throw erros.naoEncontrado('Serviço não encontrado.');

    const resultado = await executar(
      `INSERT INTO documentos_exigidos (tipo_atendimento_id, nome, descricao, obrigatorio, ordem, ativo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.params.id, d.nome, d.descricao ?? null, d.obrigatorio ? 1 : 0, d.ordem, d.ativo ? 1 : 0],
    );
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'DOCUMENTO_EXIGIDO_CRIADO',
      entidade: 'documentos_exigidos',
      entidadeId: resultado.insertId,
      detalhes: { tipoAtendimentoId: Number(req.params.id) },
    });
    res.status(201).json({ id: resultado.insertId });
  }),
);

rotasAdmin.put(
  '/documentos-exigidos/:id',
  somenteAdmin,
  validar(esquemaIdNumerico, 'params'),
  validar(esquemaDocumentoExigido),
  assincrono(async (req, res) => {
    const d = req.body as z.infer<typeof esquemaDocumentoExigido>;
    const resultado = await executar(
      `UPDATE documentos_exigidos SET nome = ?, descricao = ?, obrigatorio = ?, ordem = ?, ativo = ? WHERE id = ?`,
      [d.nome, d.descricao ?? null, d.obrigatorio ? 1 : 0, d.ordem, d.ativo ? 1 : 0, req.params.id],
    );
    if (!resultado.affectedRows) throw erros.naoEncontrado('Documento não encontrado.');
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'DOCUMENTO_EXIGIDO_ATUALIZADO',
      entidade: 'documentos_exigidos',
      entidadeId: req.params.id,
    });
    res.json({ mensagem: 'Documento atualizado.' });
  }),
);

rotasAdmin.delete(
  '/documentos-exigidos/:id',
  somenteAdmin,
  validar(esquemaIdNumerico, 'params'),
  assincrono(async (req, res) => {
    // Mantemos o histórico: o documento é desativado, não apagado.
    const resultado = await executar('UPDATE documentos_exigidos SET ativo = 0 WHERE id = ?', [
      req.params.id,
    ]);
    if (!resultado.affectedRows) throw erros.naoEncontrado('Documento não encontrado.');
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'DOCUMENTO_EXIGIDO_DESATIVADO',
      entidade: 'documentos_exigidos',
      entidadeId: req.params.id,
    });
    res.status(204).end();
  }),
);

rotasAdmin.post(
  '/tipos-atendimento/:id/documentos/ordenar',
  somenteAdmin,
  validar(esquemaIdNumerico, 'params'),
  validar(z.object({ ordem: z.array(z.coerce.number().int().positive()).min(1).max(60) })),
  assincrono(async (req, res) => {
    const { ordem } = req.body as { ordem: number[] };
    for (const [indice, documentoId] of ordem.entries()) {
      await executar(
        'UPDATE documentos_exigidos SET ordem = ? WHERE id = ? AND tipo_atendimento_id = ?',
        [indice * 10, documentoId, req.params.id],
      );
    }
    res.json({ mensagem: 'Ordem atualizada.' });
  }),
);

// -------------------------------------------------------------- configurações

rotasAdmin.get(
  '/configuracoes',
  somenteAdmin,
  assincrono(async (_req, res) => {
    res.json({ configuracoes: await listarParametros() });
  }),
);

const esquemaConfiguracao = z.object({
  valor: z.string().trim().min(1).max(255),
});

rotasAdmin.put(
  '/configuracoes/:chave',
  somenteAdmin,
  validar(z.object({ chave: z.string().trim().min(3).max(80) }), 'params'),
  validar(esquemaConfiguracao),
  assincrono(async (req, res) => {
    const { valor } = req.body as z.infer<typeof esquemaConfiguracao>;
    const atual = await consultarUm<RowDataPacket & { tipo: string }>(
      'SELECT tipo FROM configuracoes WHERE chave = ?',
      [req.params.chave],
    );
    if (!atual) throw erros.naoEncontrado('Configuração não encontrada.');

    if (atual.tipo === 'INTEIRO' && !/^\d+$/.test(valor)) {
      throw erros.invalido('Esta configuração aceita apenas números inteiros.');
    }
    if (atual.tipo === 'BOOLEANO' && !['true', 'false'].includes(valor.toLowerCase())) {
      throw erros.invalido('Esta configuração aceita apenas "true" ou "false".');
    }

    await atualizarParametro(req.params.chave, valor, req.usuario!.id);
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: 'ADMIN',
      acao: 'CONFIGURACAO_ALTERADA',
      entidade: 'configuracoes',
      entidadeId: req.params.chave,
      detalhes: { valor },
    });
    res.json({ mensagem: 'Configuração atualizada.' });
  }),
);

// ------------------------------------------------------------------ auditoria

const esquemaAuditoria = z.object({
  acao: z.string().trim().max(80).optional(),
  entidade: z.string().trim().max(60).optional(),
  usuarioId: z.coerce.number().int().positive().optional(),
  de: z.string().optional(),
  ate: z.string().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
});

rotasAdmin.get(
  '/auditoria',
  somenteAdmin,
  validar(esquemaAuditoria, 'query'),
  assincrono(async (req, res) => {
    const f = req.query as unknown as z.infer<typeof esquemaAuditoria>;
    const condicoes: string[] = [];
    const params: unknown[] = [];

    if (f.acao) {
      condicoes.push('a.acao = ?');
      params.push(f.acao);
    }
    if (f.entidade) {
      condicoes.push('a.entidade = ?');
      params.push(f.entidade);
    }
    if (f.usuarioId) {
      condicoes.push('a.usuario_id = ?');
      params.push(f.usuarioId);
    }
    if (f.de) {
      condicoes.push('a.criado_em >= ?');
      params.push(new Date(`${f.de}T00:00:00Z`));
    }
    if (f.ate) {
      condicoes.push('a.criado_em <= ?');
      params.push(new Date(`${f.ate}T23:59:59Z`));
    }
    const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const registros = await consultar<RowDataPacket>(
      `SELECT a.id, a.usuario_id, u.nome AS usuario_nome, a.ator, a.acao, a.entidade, a.entidade_id,
              a.resultado, a.ip, a.criado_em, a.detalhes
         FROM auditoria a
         LEFT JOIN usuarios u ON u.id = a.usuario_id
         ${onde}
        ORDER BY a.id DESC
        LIMIT ? OFFSET ?`,
      [...params, f.porPagina, (f.pagina - 1) * f.porPagina],
    );
    const total = await consultarUm<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM auditoria a ${onde}`,
      params,
    );

    res.json({
      registros,
      paginacao: { pagina: f.pagina, porPagina: f.porPagina, total: Number(total?.total ?? 0) },
    });
  }),
);

// ----------------------------------------------------------------- indicadores

const esquemaIndicadores = z.object({
  de: z.string().optional(),
  ate: z.string().optional(),
  unidadeId: z.coerce.number().int().positive().optional(),
  atendenteId: z.coerce.number().int().positive().optional(),
  guicheId: z.coerce.number().int().positive().optional(),
  tipoAtendimentoId: z.coerce.number().int().positive().optional(),
});

rotasAdmin.get(
  '/indicadores',
  exigirPerfil('ADMIN', 'SUPERVISOR'),
  validar(esquemaIndicadores, 'query'),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const f = req.query as unknown as z.infer<typeof esquemaIndicadores>;

    const condicoes: string[] = [];
    const params: unknown[] = [];

    // Supervisor nunca enxerga além da própria unidade.
    if (usuario.perfil === 'SUPERVISOR') {
      condicoes.push('s.unidade_id = ?');
      params.push(usuario.unidadeId);
    } else if (f.unidadeId) {
      condicoes.push('s.unidade_id = ?');
      params.push(f.unidadeId);
    }
    if (f.atendenteId) {
      condicoes.push('s.atendente_id = ?');
      params.push(f.atendenteId);
    }
    if (f.guicheId) {
      condicoes.push('s.guiche_id = ?');
      params.push(f.guicheId);
    }
    if (f.tipoAtendimentoId) {
      condicoes.push('s.tipo_atendimento_id = ?');
      params.push(f.tipoAtendimentoId);
    }
    if (f.de) {
      condicoes.push('s.criado_em >= ?');
      params.push(new Date(`${f.de}T00:00:00Z`));
    }
    if (f.ate) {
      condicoes.push('s.criado_em <= ?');
      params.push(new Date(`${f.ate}T23:59:59Z`));
    }
    const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const sessoes = await consultarUm<RowDataPacket & Record<string, number | null>>(
      `SELECT COUNT(*) AS total,
              SUM(s.status = 'CONCLUIDA') AS concluidas,
              SUM(s.status = 'CANCELADA') AS canceladas,
              SUM(s.status = 'EXPIRADA') AS expiradas,
              SUM(s.status IN ('AGUARDANDO','ACESSADA','EM_ANDAMENTO','EM_ANALISE')) AS em_aberto,
              AVG(CASE WHEN s.enviado_em IS NOT NULL
                       THEN TIMESTAMPDIFF(SECOND, s.criado_em, s.enviado_em) END) AS tempo_medio_envio_segundos,
              AVG(CASE WHEN s.encerrado_em IS NOT NULL
                       THEN TIMESTAMPDIFF(SECOND, s.criado_em, s.encerrado_em) END) AS tempo_medio_atendimento_segundos,
              SUM(s.primeiro_acesso_em IS NOT NULL) AS acessadas
         FROM sessoes s ${onde}`,
      params,
    );

    const documentos = await consultarUm<RowDataPacket & Record<string, number | null>>(
      `SELECT COUNT(*) AS total,
              SUM(d.status = 'APROVADO') AS aprovados,
              SUM(d.status IN ('REJEITADO','AGUARDANDO_NOVO_ENVIO')) AS rejeitados,
              SUM(d.status IN ('ENVIADO','EM_ANALISE','APROVADO')) AS enviados,
              SUM(d.status = 'PENDENTE') AS pendentes
         FROM sessao_documentos d
         JOIN sessoes s ON s.id = d.sessao_id ${onde}`,
      params,
    );

    const arquivos = await consultarUm<RowDataPacket & Record<string, number | null>>(
      `SELECT SUM(a.origem = 'CIDADAO') AS do_cidadao,
              SUM(a.origem = 'ATENDENTE') AS do_atendente,
              COALESCE(SUM(a.tamanho_bytes), 0) AS bytes
         FROM arquivos a
         JOIN sessoes s ON s.id = a.sessao_id
        ${onde ? `${onde} AND a.excluido_em IS NULL` : 'WHERE a.excluido_em IS NULL'}`,
      params,
    );

    const porTipo = await consultar<RowDataPacket>(
      `SELECT t.nome AS tipo, COUNT(*) AS sessoes,
              SUM(s.status = 'CONCLUIDA') AS concluidas
         FROM sessoes s
         JOIN tipos_atendimento t ON t.id = s.tipo_atendimento_id
         ${onde}
        GROUP BY t.id, t.nome
        ORDER BY sessoes DESC
        LIMIT 20`,
      params,
    );

    // O agrupamento por dia usa o fuso da operação (offset numérico, que não
    // depende das tabelas de fuso do MySQL estarem carregadas).
    const offset = offsetSql();
    const porDia = await consultar<RowDataPacket>(
      `SELECT DATE(CONVERT_TZ(s.criado_em, '+00:00', ?)) AS dia, COUNT(*) AS sessoes,
              SUM(s.status = 'CONCLUIDA') AS concluidas
         FROM sessoes s
         ${onde}
        GROUP BY DATE(CONVERT_TZ(s.criado_em, '+00:00', ?))
        ORDER BY dia DESC
        LIMIT 30`,
      [offset, ...params, offset],
    );

    res.json({
      sessoes: {
        total: Number(sessoes?.total ?? 0),
        concluidas: Number(sessoes?.concluidas ?? 0),
        canceladas: Number(sessoes?.canceladas ?? 0),
        expiradas: Number(sessoes?.expiradas ?? 0),
        emAberto: Number(sessoes?.em_aberto ?? 0),
        acessadas: Number(sessoes?.acessadas ?? 0),
        tempoMedioEnvioSegundos: Math.round(Number(sessoes?.tempo_medio_envio_segundos ?? 0)),
        tempoMedioAtendimentoSegundos: Math.round(
          Number(sessoes?.tempo_medio_atendimento_segundos ?? 0),
        ),
      },
      documentos: {
        total: Number(documentos?.total ?? 0),
        enviados: Number(documentos?.enviados ?? 0),
        aprovados: Number(documentos?.aprovados ?? 0),
        rejeitados: Number(documentos?.rejeitados ?? 0),
        pendentes: Number(documentos?.pendentes ?? 0),
      },
      arquivos: {
        doCidadao: Number(arquivos?.do_cidadao ?? 0),
        doAtendente: Number(arquivos?.do_atendente ?? 0),
        bytes: Number(arquivos?.bytes ?? 0),
      },
      porTipo,
      porDia,
    });
  }),
);
