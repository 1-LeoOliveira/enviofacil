import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { consultar, type RowDataPacket } from '../../db/pool';
import { auditar } from '../../lib/auditoria';
import { cpfValido, somenteDigitos } from '../../lib/crypto';
import { assincrono, erros } from '../../lib/errors';
import { parametroBooleano, parametrosUpload } from '../../lib/parametros';
import { exigirServidor } from '../../middleware/auth';
import { validar } from '../../middleware/validar';
import { provedorCidadaos } from '../../integrations/cidadaos';

// ------------------------------------------------- catálogo (servidor logado)

export const rotasCatalogo = Router();
rotasCatalogo.use(exigirServidor);

interface LinhaTipoCatalogo extends RowDataPacket {
  id: number;
  codigo: string;
  nome: string;
  descricao: string | null;
  categoria: string;
  ordem: number;
}

interface LinhaDocCatalogo extends RowDataPacket {
  id: number;
  tipo_atendimento_id: number;
  nome: string;
  descricao: string | null;
  obrigatorio: number;
  ordem: number;
}

rotasCatalogo.get(
  '/tipos-atendimento',
  assincrono(async (_req, res) => {
    const tipos = await consultar<LinhaTipoCatalogo>(
      `SELECT id, codigo, nome, descricao, categoria, ordem
         FROM tipos_atendimento WHERE ativo = 1 ORDER BY ordem, nome`,
    );
    const documentos = await consultar<LinhaDocCatalogo>(
      `SELECT id, tipo_atendimento_id, nome, descricao, obrigatorio, ordem
         FROM documentos_exigidos WHERE ativo = 1 ORDER BY ordem, id`,
    );

    res.json({
      tipos: tipos.map((t) => ({
        id: t.id,
        codigo: t.codigo,
        nome: t.nome,
        descricao: t.descricao,
        categoria: t.categoria,
        documentos: documentos
          .filter((d) => d.tipo_atendimento_id === t.id)
          .map((d) => ({
            id: d.id,
            nome: d.nome,
            descricao: d.descricao,
            obrigatorio: d.obrigatorio === 1,
            ordem: d.ordem,
          })),
      })),
    });
  }),
);

rotasCatalogo.get(
  '/unidades',
  assincrono(async (_req, res) => {
    const unidades = await consultar<RowDataPacket & { id: number; nome: string; sigla: string; cidade: string }>(
      'SELECT id, nome, sigla, cidade FROM unidades WHERE ativo = 1 ORDER BY nome',
    );
    res.json({ unidades });
  }),
);

rotasCatalogo.get(
  '/guiches',
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const unidadeId = Number(req.query.unidadeId ?? usuario.unidadeId ?? 0);
    if (!unidadeId) {
      res.json({ guiches: [] });
      return;
    }
    if (usuario.perfil !== 'ADMIN' && unidadeId !== usuario.unidadeId) {
      throw erros.semPermissao('Você só pode consultar guichês da sua unidade.');
    }
    const guiches = await consultar<RowDataPacket & { id: number; identificacao: string }>(
      'SELECT id, identificacao FROM guiches WHERE unidade_id = ? AND ativo = 1 ORDER BY identificacao',
      [unidadeId],
    );
    res.json({ guiches });
  }),
);

// ------------------------------------------- consulta de cidadão (integração)

export const rotasCidadaos = Router();
rotasCidadaos.use(exigirServidor);

const esquemaConsulta = z.object({ cpf: z.string().min(11).max(14) });

rotasCidadaos.get(
  '/consultar',
  validar(esquemaConsulta, 'query'),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const cpf = somenteDigitos((req.query as unknown as z.infer<typeof esquemaConsulta>).cpf);

    if (!cpfValido(cpf)) {
      throw erros.invalido('CPF inválido. Confira os números informados.');
    }

    const provedor = provedorCidadaos();
    const cidadao = await provedor.consultarPorCpf(cpf);

    await auditar(req, {
      usuarioId: usuario.id,
      ator: usuario.perfil,
      acao: 'CONSULTA_CPF',
      entidade: 'cidadaos',
      resultado: cidadao ? 'SUCESSO' : 'FALHA',
      detalhes: { provedor: provedor.nome, encontrado: Boolean(cidadao) },
    });

    if (!cidadao) {
      throw erros.naoEncontrado(
        'CPF não localizado na base consultada. Confira o número ou siga o procedimento de identificação manual.',
      );
    }

    res.json({
      cidadao: {
        nome: cidadao.nome,
        cpfMascarado: cidadao.cpfMascarado,
        nascimento: cidadao.nascimento ?? null,
      },
      integracao: {
        provedor: provedor.nome,
        origem: cidadao.origem,
        demonstracao: cidadao.demonstracao,
        aviso: cidadao.demonstracao
          ? 'Dado proveniente da base fictícia de demonstração. Não utilizar para decisão administrativa.'
          : null,
      },
    });
  }),
);

// -------------------------------------------- parâmetros públicos (portal)

export const rotasPublicas = Router();

/** Informações não sensíveis necessárias ao portal do cidadão. */
rotasPublicas.get(
  '/parametros',
  assincrono(async (_req, res) => {
    const upload = await parametrosUpload();
    const avisoDemo = await parametroBooleano('aviso_ambiente_demonstracao');

    // Com o login desabilitado, a interface precisa saber por quem entrar.
    // Só nomes e perfis — nenhum dado sensível, e apenas neste modo.
    const usuariosDemo = env.loginDesabilitado
      ? await consultar<RowDataPacket & { id: number; nome: string; perfil: string; unidade_sigla: string | null }>(
          `SELECT u.id, u.nome, u.perfil, un.sigla AS unidade_sigla
             FROM usuarios u
             LEFT JOIN unidades un ON un.id = u.unidade_id
            WHERE u.ativo = 1
            ORDER BY FIELD(u.perfil, 'ATENDENTE', 'SUPERVISOR', 'ADMIN'), u.nome
            LIMIT 20`,
        )
      : [];

    res.json({
      upload: {
        tamanhoMaximoMb: Math.round(upload.tamanhoMaximoBytes / (1024 * 1024)),
        maxArquivosPorDocumento: upload.maxArquivosPorDocumento,
        formatos: upload.formatos,
      },
      ambiente: {
        demonstracao: avisoDemo,
        provedorIdentificacao: env.cidadaos.provedor,
      },
      autenticacao: {
        loginDesabilitado: env.loginDesabilitado,
        usuarios: usuariosDemo.map((u) => ({
          id: u.id,
          nome: u.nome,
          perfil: u.perfil,
          unidadeSigla: u.unidade_sigla,
        })),
      },
    });
  }),
);
