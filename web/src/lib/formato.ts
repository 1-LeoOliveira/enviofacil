import type { StatusDocumento, StatusSessao } from './tipos';

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const horaCurta = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dataHora.format(new Date(iso));
}

export function formatarHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return horaCurta.format(new Date(iso));
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatarDuracao(segundos: number): string {
  if (!segundos || segundos < 0) return '—';
  if (segundos < 60) return `${Math.round(segundos)} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `${horas} h ${minutos % 60} min`;
}

export function mascararCpfEntrada(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function cpfValido(valor: string): boolean {
  const cpf = valor.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    if ((resto === 10 ? 0 : resto) !== Number(cpf[tamanho])) return false;
  }
  return true;
}

interface Aparencia {
  rotulo: string;
  classe: string;
}

export const APARENCIA_SESSAO: Record<StatusSessao, Aparencia> = {
  AGUARDANDO: { rotulo: 'Aguardando acesso', classe: 'bg-slate-100 text-slate-700' },
  ACESSADA: { rotulo: 'Cidadão conectado', classe: 'bg-sky-100 text-sky-800' },
  EM_ANDAMENTO: { rotulo: 'Enviando documentos', classe: 'bg-indigo-100 text-indigo-800' },
  EM_ANALISE: { rotulo: 'Em conferência', classe: 'bg-amber-100 text-amber-800' },
  CONCLUIDA: { rotulo: 'Concluída', classe: 'bg-emerald-100 text-emerald-800' },
  EXPIRADA: { rotulo: 'Expirada', classe: 'bg-slate-200 text-slate-600' },
  CANCELADA: { rotulo: 'Cancelada', classe: 'bg-rose-100 text-rose-800' },
};

export const APARENCIA_DOCUMENTO: Record<StatusDocumento, Aparencia> = {
  PENDENTE: { rotulo: 'Pendente', classe: 'bg-slate-100 text-slate-600' },
  ANEXADO: { rotulo: 'Arquivo anexado', classe: 'bg-sky-100 text-sky-800' },
  ENVIADO: { rotulo: 'Enviado', classe: 'bg-indigo-100 text-indigo-800' },
  EM_ANALISE: { rotulo: 'Em análise', classe: 'bg-amber-100 text-amber-800' },
  APROVADO: { rotulo: 'Aprovado', classe: 'bg-emerald-100 text-emerald-800' },
  REJEITADO: { rotulo: 'Rejeitado', classe: 'bg-rose-100 text-rose-800' },
  AGUARDANDO_NOVO_ENVIO: { rotulo: 'Reenvio necessário', classe: 'bg-orange-100 text-orange-800' },
};

export function tempoRestante(expiraEm: string): string {
  const minutos = Math.floor((new Date(expiraEm).getTime() - Date.now()) / 60000);
  if (minutos <= 0) return 'prazo encerrado';
  if (minutos < 60) return `${minutos} min restantes`;
  const horas = Math.floor(minutos / 60);
  return `${horas} h ${minutos % 60} min restantes`;
}
