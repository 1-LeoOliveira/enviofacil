import { env } from '../../config/env';
import { mascararCpf, somenteDigitos } from '../../lib/crypto';
import { erros } from '../../lib/errors';
import { log } from '../../lib/logger';
import type { CidadaoIdentificado, ProvedorCidadaos } from './index';

/**
 * Adaptador para a base institucional de cidadãos (Fase 4).
 *
 * Não há simulação aqui: sem `CIDADAO_API_URL` configurada, o adaptador
 * responde que o serviço está indisponível. O contrato esperado é:
 *
 *   GET {CIDADAO_API_URL}?cpf=00000000000
 *   Authorization: Bearer {CIDADAO_API_TOKEN}
 *   200 -> { "nome": "...", "nascimento": "1985-04-12" }
 *   404 -> cidadão não encontrado
 *
 * Ajustar o mapeamento abaixo conforme o contrato real publicado pelo DETRAN/SC.
 */
export const provedorHttpInstitucional: ProvedorCidadaos = {
  nome: 'institucional',

  async consultarPorCpf(cpf: string): Promise<CidadaoIdentificado | null> {
    if (!env.cidadaos.apiUrl) {
      throw erros.indisponivel(
        'A integração com a base institucional de cidadãos não está configurada neste ambiente.',
      );
    }

    const controlador = new AbortController();
    const timeout = setTimeout(() => controlador.abort(), env.cidadaos.timeoutMs);

    try {
      const url = new URL(env.cidadaos.apiUrl);
      url.searchParams.set('cpf', somenteDigitos(cpf));

      const resposta = await fetch(url, {
        method: 'GET',
        signal: controlador.signal,
        headers: {
          Accept: 'application/json',
          ...(env.cidadaos.apiToken ? { Authorization: `Bearer ${env.cidadaos.apiToken}` } : {}),
        },
      });

      if (resposta.status === 404) return null;
      if (!resposta.ok) {
        log.error('Base institucional respondeu com erro', { status: resposta.status });
        throw erros.indisponivel(
          'A base institucional está indisponível neste momento. Tente novamente em instantes.',
        );
      }

      const corpo = (await resposta.json()) as { nome?: string; nascimento?: string };
      if (!corpo?.nome) return null;

      return {
        nome: corpo.nome,
        cpfMascarado: mascararCpf(cpf),
        nascimento: corpo.nascimento ?? null,
        origem: 'institucional',
        demonstracao: false,
      };
    } catch (erro) {
      if ((erro as Error).name === 'AbortError') {
        throw erros.indisponivel('A consulta à base institucional excedeu o tempo limite.');
      }
      throw erro;
    } finally {
      clearTimeout(timeout);
    }
  },

  async disponivel(): Promise<boolean> {
    return Boolean(env.cidadaos.apiUrl);
  },
};
