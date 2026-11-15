import { env } from '../../config/env';
import { provedorDemonstracao } from './demo';
import { provedorHttpInstitucional } from './http';

export interface CidadaoIdentificado {
  nome: string;
  cpfMascarado: string;
  nascimento?: string | null;
  /** Identifica a procedência do dado: nunca apresentar demo como oficial. */
  origem: 'demo' | 'institucional';
  demonstracao: boolean;
}

/**
 * Camada de integração com a base institucional de cidadãos.
 *
 * Enquanto não houver acesso à API do DETRAN/SC, o provedor `demo` responde a
 * partir de uma base fictícia e toda resposta carrega `demonstracao: true`,
 * para que a interface deixe isso explícito ao atendente.
 */
export interface ProvedorCidadaos {
  readonly nome: string;
  consultarPorCpf(cpf: string): Promise<CidadaoIdentificado | null>;
  disponivel(): Promise<boolean>;
}

export function provedorCidadaos(): ProvedorCidadaos {
  return env.cidadaos.provedor === 'http' ? provedorHttpInstitucional : provedorDemonstracao;
}
