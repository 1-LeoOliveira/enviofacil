import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatarDataHora } from '../../lib/formato';
import { Alerta, Carregando, Vazio } from '../../components/ui';

interface RegistroAuditoria {
  id: number;
  usuario_id: number | null;
  usuario_nome: string | null;
  ator: string;
  acao: string;
  entidade: string;
  entidade_id: string | null;
  resultado: 'SUCESSO' | 'FALHA';
  ip: string | null;
  criado_em: string;
  detalhes: Record<string, unknown> | null;
}

const ACOES = [
  'LOGIN',
  'LOGOUT',
  'SENHA_ALTERADA',
  'CONSULTA_CPF',
  'SESSAO_CRIADA',
  'SESSAO_CONCLUIDA',
  'SESSAO_CANCELADA',
  'CPF_REVELADO',
  'DOCUMENTOS_ENVIADOS',
  'DOCUMENTO_APROVADO',
  'DOCUMENTO_REJEITADO',
  'ARQUIVO_LINK_GERADO',
  'ARQUIVO_DISPONIBILIZADO',
  'PORTAL_ACESSADO',
  'PORTAL_ACESSO_NEGADO',
  'CONFIGURACAO_ALTERADA',
  'RETENCAO_DESCARTE',
];

export function Auditoria() {
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [filtros, setFiltros] = useState({ acao: '', de: '', ate: '' });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const porPagina = 50;

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const parametros = new URLSearchParams();
      if (filtros.acao) parametros.set('acao', filtros.acao);
      if (filtros.de) parametros.set('de', filtros.de);
      if (filtros.ate) parametros.set('ate', filtros.ate);
      parametros.set('pagina', String(pagina));
      parametros.set('porPagina', String(porPagina));

      const resposta = await api.get<{
        registros: RegistroAuditoria[];
        paginacao: { total: number };
      }>(`/admin/auditoria?${parametros.toString()}`);
      setRegistros(resposta.registros);
      setTotal(resposta.paginacao.total);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [filtros, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const paginas = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-detran-900">Trilha de auditoria</h1>
        <p className="text-sm text-slate-500">
          Registro das operações sensíveis. Não armazena CPF, token ou conteúdo de documentos.
        </p>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      <div className="cartao cartao-corpo flex flex-wrap items-end gap-3">
        <div>
          <label className="rotulo">Ação</label>
          <select
            className="campo w-60"
            value={filtros.acao}
            onChange={(e) => {
              setFiltros({ ...filtros, acao: e.target.value });
              setPagina(1);
            }}
          >
            <option value="">Todas</option>
            {ACOES.map((acao) => (
              <option key={acao} value={acao}>
                {acao}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rotulo">De</label>
          <input
            type="date"
            className="campo"
            value={filtros.de}
            onChange={(e) => {
              setFiltros({ ...filtros, de: e.target.value });
              setPagina(1);
            }}
          />
        </div>
        <div>
          <label className="rotulo">Até</label>
          <input
            type="date"
            className="campo"
            value={filtros.ate}
            onChange={(e) => {
              setFiltros({ ...filtros, ate: e.target.value });
              setPagina(1);
            }}
          />
        </div>
        <button
          type="button"
          className="botao-neutro"
          onClick={() => {
            setFiltros({ acao: '', de: '', ate: '' });
            setPagina(1);
          }}
        >
          Limpar
        </button>
        <span className="ml-auto text-sm text-slate-500">{total} registro(s)</span>
      </div>

      <div className="cartao overflow-hidden">
        {carregando ? (
          <Carregando />
        ) : !registros.length ? (
          <div className="p-5">
            <Vazio titulo="Nenhum registro encontrado" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Ator</th>
                  <th>Ação</th>
                  <th>Entidade</th>
                  <th>Resultado</th>
                  <th>IP</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {registros.map((registro) => (
                  <tr key={registro.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap text-slate-500">{formatarDataHora(registro.criado_em)}</td>
                    <td>
                      <p className="text-slate-800">{registro.usuario_nome ?? '—'}</p>
                      <p className="text-xs text-slate-400">{registro.ator}</p>
                    </td>
                    <td className="font-mono text-xs">{registro.acao}</td>
                    <td className="text-slate-600">
                      {registro.entidade}
                      {registro.entidade_id && (
                        <span className="block max-w-[180px] truncate font-mono text-[11px] text-slate-400">
                          {registro.entidade_id}
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`etiqueta ${
                          registro.resultado === 'SUCESSO' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {registro.resultado.toLowerCase()}
                      </span>
                    </td>
                    <td className="font-mono text-xs text-slate-400">{registro.ip ?? '—'}</td>
                    <td className="max-w-[260px]">
                      {registro.detalhes ? (
                        <code className="block truncate text-[11px] text-slate-500">
                          {JSON.stringify(registro.detalhes)}
                        </code>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {paginas > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button type="button" className="botao-neutro" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </button>
          <span className="text-slate-500">
            Página {pagina} de {paginas}
          </span>
          <button type="button" className="botao-neutro" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
