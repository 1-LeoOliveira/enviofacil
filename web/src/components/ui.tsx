import type { ReactNode } from 'react';
import { APARENCIA_DOCUMENTO, APARENCIA_SESSAO } from '../lib/formato';
import type { StatusDocumento, StatusSessao } from '../lib/tipos';

export function Marca({ compacta = false, invertida = false }: { compacta?: boolean; invertida?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          invertida ? 'bg-white/15 text-white' : 'bg-detran-700 text-white'
        }`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
          <path d="M12 9v6M9 12l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {!compacta && (
        <span className="leading-tight">
          <span className={`block font-bold ${invertida ? 'text-white' : 'text-detran-900'}`}>
            Envio Fácil
          </span>
          <span className={`block text-[11px] font-medium ${invertida ? 'text-detran-100' : 'text-slate-500'}`}>
            DETRAN · Santa Catarina
          </span>
        </span>
      )}
    </div>
  );
}

export function EtiquetaSessao({ status }: { status: StatusSessao }) {
  const aparencia = APARENCIA_SESSAO[status];
  return <span className={`etiqueta ${aparencia.classe}`}>{aparencia.rotulo}</span>;
}

export function EtiquetaDocumento({ status }: { status: StatusDocumento }) {
  const aparencia = APARENCIA_DOCUMENTO[status];
  return <span className={`etiqueta ${aparencia.classe}`}>{aparencia.rotulo}</span>;
}

type TipoAlerta = 'info' | 'sucesso' | 'atencao' | 'erro';

const ESTILO_ALERTA: Record<TipoAlerta, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  sucesso: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  atencao: 'border-amber-200 bg-amber-50 text-amber-900',
  erro: 'border-rose-200 bg-rose-50 text-rose-900',
};

export function Alerta({
  tipo = 'info',
  titulo,
  children,
  acao,
}: {
  tipo?: TipoAlerta;
  titulo?: string;
  children?: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${ESTILO_ALERTA[tipo]}`} role="alert">
      <div className="flex items-start justify-between gap-3">
        <div>
          {titulo && <p className="font-semibold">{titulo}</p>}
          {children && <div className={titulo ? 'mt-1' : ''}>{children}</div>}
        </div>
        {acao}
      </div>
    </div>
  );
}

export function Carregando({ texto = 'Carregando...' }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-detran-200 border-t-detran-700" />
      {texto}
    </div>
  );
}

export function Vazio({ titulo, descricao, acao }: { titulo: string; descricao?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <p className="font-medium text-slate-700">{titulo}</p>
      {descricao && <p className="max-w-md text-sm text-slate-500">{descricao}</p>}
      {acao}
    </div>
  );
}

export function BarraProgresso({
  valor,
  total,
  rotulo,
}: {
  valor: number;
  total: number;
  rotulo?: string;
}) {
  const percentual = total ? Math.round((valor / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{rotulo ?? 'Progresso'}</span>
        <span className="text-slate-500">
          {valor} de {total} ({percentual}%)
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={percentual} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            percentual === 100 ? 'bg-acento-500' : 'bg-detran-600'
          }`}
          style={{ width: `${percentual}%` }}
        />
      </div>
    </div>
  );
}

export function Modal({
  aberto,
  titulo,
  children,
  aoFechar,
  largura = 'max-w-lg',
}: {
  aberto: boolean;
  titulo: string;
  children: ReactNode;
  aoFechar: () => void;
  largura?: string;
}) {
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-detran-900/50 p-0 sm:items-center sm:p-4">
      <div className={`w-full ${largura} rounded-t-2xl bg-white shadow-xl sm:rounded-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-detran-900">{titulo}</h2>
          <button type="button" onClick={aoFechar} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Fechar">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function AvisoDemonstracao({ compacto = false }: { compacto?: boolean }) {
  return (
    <div className={`faixa-demo border-y border-amber-300 ${compacto ? 'px-3 py-1.5' : 'px-4 py-2'}`}>
      <p className="mx-auto flex max-w-6xl items-center gap-2 text-[12px] font-semibold text-amber-900">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" />
        </svg>
        Ambiente de demonstração — identificação do cidadão vinda de base fictícia, sem validade administrativa.
      </p>
    </div>
  );
}

export function Indicador({
  rotulo,
  valor,
  detalhe,
  destaque = false,
}: {
  rotulo: string;
  valor: number | string;
  detalhe?: string;
  destaque?: boolean;
}) {
  return (
    <div className={`cartao cartao-corpo ${destaque ? 'border-detran-200 bg-detran-50' : ''}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className={`mt-1 text-2xl font-bold ${destaque ? 'text-detran-800' : 'text-slate-800'}`}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-slate-500">{detalhe}</p>}
    </div>
  );
}
