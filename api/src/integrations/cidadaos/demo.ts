import { consultarUm, type RowDataPacket } from '../../db/pool';
import { hmacCpf, mascararCpf } from '../../lib/crypto';
import type { CidadaoIdentificado, ProvedorCidadaos } from './index';

interface LinhaDemo extends RowDataPacket {
  nome: string;
  cpf: string;
  nascimento: Date | null;
}

/**
 * AMBIENTE DE DEMONSTRAÇÃO.
 * Consulta a tabela `demo_cidadaos`, que contém dados FICTÍCIOS criados pela
 * carga inicial. Não representa e não deve ser apresentada como a base
 * institucional de cidadãos.
 */
export const provedorDemonstracao: ProvedorCidadaos = {
  nome: 'demonstracao',

  async consultarPorCpf(cpf: string): Promise<CidadaoIdentificado | null> {
    const linha = await consultarUm<LinhaDemo>(
      'SELECT nome, cpf, nascimento FROM demo_cidadaos WHERE cpf_hash = ? LIMIT 1',
      [hmacCpf(cpf)],
    );
    if (!linha) return null;
    return {
      nome: linha.nome,
      cpfMascarado: mascararCpf(linha.cpf),
      nascimento: linha.nascimento ? linha.nascimento.toISOString().slice(0, 10) : null,
      origem: 'demo',
      demonstracao: true,
    };
  },

  async disponivel(): Promise<boolean> {
    return true;
  },
};
