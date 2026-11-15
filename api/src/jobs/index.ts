import { consultar, executar, type RowDataPacket } from '../db/pool';
import { auditar } from '../lib/auditoria';
import { parametroInteiro } from '../lib/parametros';
import { log } from '../lib/logger';
import { desconectarCidadaos, emitirAtendente, emitirSessao } from '../realtime';
import { registrarEvento } from '../modules/sessoes/service';
import { armazenamento } from '../storage';

/** Expira sessões vencidas e avisa quem estiver com a tela aberta. */
export async function expirarSessoes(): Promise<number> {
  const vencidas = await consultar<RowDataPacket & { id: string; atendente_id: number; cidadao_nome: string }>(
    `SELECT id, atendente_id, cidadao_nome
       FROM sessoes
      WHERE status IN ('AGUARDANDO','ACESSADA','EM_ANDAMENTO','EM_ANALISE')
        AND expira_em <= ?`,
    [new Date()],
  );

  for (const sessao of vencidas) {
    await executar(`UPDATE sessoes SET status = 'EXPIRADA' WHERE id = ?`, [sessao.id]);
    await registrarEvento(sessao.id, {
      tipo: 'sessao:expirada',
      ator: 'SISTEMA',
      mensagem: 'A sessão expirou por decurso de prazo.',
    });
    emitirSessao({
      sessaoId: sessao.id,
      evento: 'sessao:encerrada',
      mensagem: 'O prazo deste atendimento expirou. Procure o atendente para gerar um novo acesso.',
      dados: { status: 'EXPIRADA' },
    });
    emitirAtendente(sessao.atendente_id, {
      sessaoId: sessao.id,
      evento: 'sessao:encerrada',
      mensagem: `A sessão de ${sessao.cidadao_nome} expirou.`,
    });
    await desconectarCidadaos(sessao.id);
  }

  if (vencidas.length) log.info('Sessões expiradas', { quantidade: vencidas.length });
  return vencidas.length;
}

/**
 * Política de retenção (LGPD): após o prazo configurado, o conteúdo dos
 * arquivos é descartado em definitivo. Os metadados ficam para auditoria.
 */
export async function descartarArquivosVencidos(): Promise<number> {
  const dias = await parametroInteiro('retencao_arquivos_dias');
  if (dias <= 0) return 0;

  const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  const arquivos = await consultar<RowDataPacket & { id: string; chave_armazenamento: string; sessao_id: string }>(
    `SELECT a.id, a.chave_armazenamento, a.sessao_id
       FROM arquivos a
       JOIN sessoes s ON s.id = a.sessao_id
      WHERE a.excluido_em IS NULL
        AND s.status IN ('CONCLUIDA','CANCELADA','EXPIRADA')
        AND COALESCE(s.encerrado_em, s.expira_em) <= ?
      LIMIT 500`,
    [limite],
  );

  for (const arquivo of arquivos) {
    try {
      await armazenamento.remover(arquivo.chave_armazenamento);
      await executar('UPDATE arquivos SET excluido_em = ? WHERE id = ?', [new Date(), arquivo.id]);
    } catch (erro) {
      log.error('Falha ao descartar arquivo vencido', {
        arquivo: arquivo.id,
        mensagem: (erro as Error).message,
      });
    }
  }

  if (arquivos.length) {
    log.info('Arquivos descartados pela política de retenção', {
      quantidade: arquivos.length,
      retencaoDias: dias,
    });
    await auditar(null, {
      acao: 'RETENCAO_DESCARTE',
      entidade: 'arquivos',
      detalhes: { quantidade: arquivos.length, retencaoDias: dias },
    });
  }
  return arquivos.length;
}

let timers: NodeJS.Timeout[] = [];

export function iniciarRotinas(): void {
  const umMinuto = 60_000;
  const umaHora = 60 * umMinuto;

  const rodar = async (nome: string, fn: () => Promise<number>) => {
    try {
      await fn();
    } catch (erro) {
      log.error('Falha em rotina agendada', { rotina: nome, mensagem: (erro as Error).message });
    }
  };

  void rodar('expirarSessoes', expirarSessoes);
  timers.push(setInterval(() => void rodar('expirarSessoes', expirarSessoes), umMinuto));
  timers.push(
    setInterval(() => void rodar('descartarArquivosVencidos', descartarArquivosVencidos), umaHora),
  );
  log.info('Rotinas agendadas iniciadas', { expiracao: '1 min', retencao: '1 h' });
}

export function pararRotinas(): void {
  for (const timer of timers) clearInterval(timer);
  timers = [];
}
