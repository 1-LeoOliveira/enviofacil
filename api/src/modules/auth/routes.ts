import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { consultarUm, executar, type RowDataPacket } from '../../db/pool';
import { env } from '../../config/env';
import { auditar } from '../../lib/auditoria';
import { assincrono, erros } from '../../lib/errors';
import { assinarTokenServidor, exigirServidor, type Perfil } from '../../middleware/auth';
import { limiteLogin } from '../../middleware/limites';
import { validar } from '../../middleware/validar';

export const rotasAuth = Router();

const MAX_TENTATIVAS = 5;
const BLOQUEIO_MINUTOS = 15;

interface LinhaLogin extends RowDataPacket {
  id: number;
  nome: string;
  email: string;
  senha_hash: string;
  perfil: Perfil;
  unidade_id: number | null;
  guiche_id: number | null;
  ativo: number;
  tentativas_falhas: number;
  bloqueado_ate: Date | null;
  deve_trocar_senha: number;
  unidade_nome: string | null;
  unidade_sigla: string | null;
  guiche_identificacao: string | null;
}

const esquemaLogin = z.object({
  email: z.string().trim().email('Informe um e-mail válido.').max(160),
  senha: z.string().min(8, 'A senha deve ter ao menos 8 caracteres.').max(200),
});

rotasAuth.post(
  '/login',
  limiteLogin,
  validar(esquemaLogin),
  assincrono(async (req, res) => {
    const { email, senha } = req.body as z.infer<typeof esquemaLogin>;

    const usuario = await consultarUm<LinhaLogin>(
      `SELECT u.id, u.nome, u.email, u.senha_hash, u.perfil, u.unidade_id, u.guiche_id, u.ativo,
              u.tentativas_falhas, u.bloqueado_ate, u.deve_trocar_senha,
              un.nome AS unidade_nome, un.sigla AS unidade_sigla, g.identificacao AS guiche_identificacao
         FROM usuarios u
         LEFT JOIN unidades un ON un.id = u.unidade_id
         LEFT JOIN guiches g ON g.id = u.guiche_id
        WHERE u.email = ?`,
      [email.toLowerCase()],
    );

    // Mensagem única para e-mail inexistente e senha errada (evita enumeração).
    const credenciaisInvalidas = erros.naoAutenticado('E-mail ou senha incorretos.');

    if (!usuario) {
      await auditar(req, {
        acao: 'LOGIN',
        entidade: 'usuarios',
        resultado: 'FALHA',
        detalhes: { motivo: 'usuario_inexistente' },
      });
      throw credenciaisInvalidas;
    }

    if (!usuario.ativo) {
      await auditar(req, {
        usuarioId: usuario.id,
        acao: 'LOGIN',
        entidade: 'usuarios',
        entidadeId: usuario.id,
        resultado: 'FALHA',
        detalhes: { motivo: 'usuario_inativo' },
      });
      throw erros.semPermissao('Usuário inativo. Procure o administrador do sistema.');
    }

    if (usuario.bloqueado_ate && usuario.bloqueado_ate.getTime() > Date.now()) {
      const minutos = Math.ceil((usuario.bloqueado_ate.getTime() - Date.now()) / 60000);
      throw erros.muitasTentativas(
        `Acesso bloqueado temporariamente por tentativas incorretas. Tente novamente em ${minutos} minuto(s).`,
      );
    }

    const confere = await bcrypt.compare(senha, usuario.senha_hash);
    if (!confere) {
      const tentativas = usuario.tentativas_falhas + 1;
      const bloquear = tentativas >= MAX_TENTATIVAS;
      await executar(
        'UPDATE usuarios SET tentativas_falhas = ?, bloqueado_ate = ? WHERE id = ?',
        [
          bloquear ? 0 : tentativas,
          bloquear ? new Date(Date.now() + BLOQUEIO_MINUTOS * 60_000) : null,
          usuario.id,
        ],
      );
      await auditar(req, {
        usuarioId: usuario.id,
        acao: 'LOGIN',
        entidade: 'usuarios',
        entidadeId: usuario.id,
        resultado: 'FALHA',
        detalhes: { motivo: 'senha_incorreta', tentativas, bloqueado: bloquear },
      });
      if (bloquear) {
        throw erros.muitasTentativas(
          `Acesso bloqueado por ${BLOQUEIO_MINUTOS} minutos após ${MAX_TENTATIVAS} tentativas incorretas.`,
        );
      }
      throw credenciaisInvalidas;
    }

    await executar(
      'UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_login_em = ? WHERE id = ?',
      [new Date(), usuario.id],
    );

    const token = assinarTokenServidor({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      unidadeId: usuario.unidade_id,
      guicheId: usuario.guiche_id,
    });

    await auditar(req, {
      usuarioId: usuario.id,
      ator: usuario.perfil,
      acao: 'LOGIN',
      entidade: 'usuarios',
      entidadeId: usuario.id,
    });

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil,
        deveTrocarSenha: usuario.deve_trocar_senha === 1,
        unidade: usuario.unidade_id
          ? { id: usuario.unidade_id, nome: usuario.unidade_nome, sigla: usuario.unidade_sigla }
          : null,
        guiche: usuario.guiche_id
          ? { id: usuario.guiche_id, identificacao: usuario.guiche_identificacao }
          : null,
      },
    });
  }),
);

/**
 * Acesso direto, sem senha, para o ambiente de demonstração.
 *
 * Só existe quando LOGIN_DESABILITADO=true e fora de produção. A autenticação
 * real continua intacta: esta rota apenas emite o mesmo JWT que o login emitiria,
 * para que todo o resto (perfis, escopo por unidade, auditoria) siga valendo.
 */
rotasAuth.post(
  '/acesso-direto',
  limiteLogin,
  validar(z.object({ usuarioId: z.coerce.number().int().positive().optional() })),
  assincrono(async (req, res) => {
    if (!env.loginDesabilitado) {
      throw erros.semPermissao('O acesso sem senha está desativado neste ambiente.');
    }

    const { usuarioId } = req.body as { usuarioId?: number };
    const usuario = usuarioId
      ? await consultarUm<LinhaLogin>(
          `SELECT u.id, u.nome, u.email, u.senha_hash, u.perfil, u.unidade_id, u.guiche_id, u.ativo,
                  u.tentativas_falhas, u.bloqueado_ate, u.deve_trocar_senha,
                  un.nome AS unidade_nome, un.sigla AS unidade_sigla, g.identificacao AS guiche_identificacao
             FROM usuarios u
             LEFT JOIN unidades un ON un.id = u.unidade_id
             LEFT JOIN guiches g ON g.id = u.guiche_id
            WHERE u.id = ? AND u.ativo = 1`,
          [usuarioId],
        )
      : await consultarUm<LinhaLogin>(
          `SELECT u.id, u.nome, u.email, u.senha_hash, u.perfil, u.unidade_id, u.guiche_id, u.ativo,
                  u.tentativas_falhas, u.bloqueado_ate, u.deve_trocar_senha,
                  un.nome AS unidade_nome, un.sigla AS unidade_sigla, g.identificacao AS guiche_identificacao
             FROM usuarios u
             LEFT JOIN unidades un ON un.id = u.unidade_id
             LEFT JOIN guiches g ON g.id = u.guiche_id
            WHERE u.ativo = 1
            ORDER BY FIELD(u.perfil, 'ATENDENTE', 'SUPERVISOR', 'ADMIN'), u.id
            LIMIT 1`,
        );

    if (!usuario) {
      throw erros.naoEncontrado('Nenhum usuário de demonstração disponível. Rode a carga inicial.');
    }

    const token = assinarTokenServidor({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      unidadeId: usuario.unidade_id,
      guicheId: usuario.guiche_id,
    });

    await auditar(req, {
      usuarioId: usuario.id,
      ator: usuario.perfil,
      acao: 'LOGIN_SEM_SENHA',
      entidade: 'usuarios',
      entidadeId: usuario.id,
      detalhes: { modo: 'demonstracao_sem_login' },
    });

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil,
        deveTrocarSenha: false,
        unidade: usuario.unidade_id
          ? { id: usuario.unidade_id, nome: usuario.unidade_nome, sigla: usuario.unidade_sigla }
          : null,
        guiche: usuario.guiche_id
          ? { id: usuario.guiche_id, identificacao: usuario.guiche_identificacao }
          : null,
      },
    });
  }),
);

rotasAuth.get(
  '/eu',
  exigirServidor,
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const detalhe = await consultarUm<LinhaLogin>(
      `SELECT u.id, u.nome, u.email, u.senha_hash, u.perfil, u.unidade_id, u.guiche_id, u.ativo,
              u.tentativas_falhas, u.bloqueado_ate, u.deve_trocar_senha,
              un.nome AS unidade_nome, un.sigla AS unidade_sigla, g.identificacao AS guiche_identificacao
         FROM usuarios u
         LEFT JOIN unidades un ON un.id = u.unidade_id
         LEFT JOIN guiches g ON g.id = u.guiche_id
        WHERE u.id = ?`,
      [usuario.id],
    );
    if (!detalhe) throw erros.naoAutenticado();

    res.json({
      usuario: {
        id: detalhe.id,
        nome: detalhe.nome,
        email: detalhe.email,
        perfil: detalhe.perfil,
        deveTrocarSenha: detalhe.deve_trocar_senha === 1,
        unidade: detalhe.unidade_id
          ? { id: detalhe.unidade_id, nome: detalhe.unidade_nome, sigla: detalhe.unidade_sigla }
          : null,
        guiche: detalhe.guiche_id
          ? { id: detalhe.guiche_id, identificacao: detalhe.guiche_identificacao }
          : null,
      },
    });
  }),
);

const esquemaTrocaSenha = z.object({
  senhaAtual: z.string().min(8).max(200),
  novaSenha: z
    .string()
    .min(10, 'A nova senha deve ter ao menos 10 caracteres.')
    .max(200)
    .refine((s) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s), {
      message: 'A nova senha deve conter letras maiúsculas, minúsculas e números.',
    }),
});

rotasAuth.post(
  '/trocar-senha',
  exigirServidor,
  validar(esquemaTrocaSenha),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const { senhaAtual, novaSenha } = req.body as z.infer<typeof esquemaTrocaSenha>;

    const linha = await consultarUm<RowDataPacket & { senha_hash: string }>(
      'SELECT senha_hash FROM usuarios WHERE id = ?',
      [usuario.id],
    );
    if (!linha || !(await bcrypt.compare(senhaAtual, linha.senha_hash))) {
      throw erros.naoAutenticado('Senha atual incorreta.');
    }
    if (senhaAtual === novaSenha) {
      throw erros.invalido('A nova senha deve ser diferente da atual.');
    }

    await executar(
      'UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 0 WHERE id = ?',
      [await bcrypt.hash(novaSenha, 10), usuario.id],
    );
    await auditar(req, {
      usuarioId: usuario.id,
      ator: usuario.perfil,
      acao: 'SENHA_ALTERADA',
      entidade: 'usuarios',
      entidadeId: usuario.id,
    });
    res.json({ mensagem: 'Senha alterada com sucesso.' });
  }),
);

rotasAuth.post(
  '/logout',
  exigirServidor,
  assincrono(async (req, res) => {
    await auditar(req, {
      usuarioId: req.usuario!.id,
      ator: req.usuario!.perfil,
      acao: 'LOGOUT',
      entidade: 'usuarios',
      entidadeId: req.usuario!.id,
    });
    res.json({ mensagem: 'Sessão encerrada.' });
  }),
);
