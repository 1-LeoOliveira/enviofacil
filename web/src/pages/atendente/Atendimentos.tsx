import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAutenticacao } from '../../lib/autenticacao';
import { formatarDataHora } from '../../lib/formato';
import type { ItemListaSessao } from '../../lib/tipos';
import { Alerta, Carregando, EtiquetaSessao, Vazio } from '../../components/ui';

const FILTROS: Array<{ rotulo: string; valor: string }> = [
  { rotulo: 'Em aberto', valor: 'AGUARDANDO,ACESSADA,EM_ANDAMENTO,EM_ANALISE' },
  { rotulo: 'Para conferir', valor: 'EM_ANALISE' },
  { rotulo: 'Concluídos', valor: 'CONCLUIDA' },
  { rotulo: 'Encerrados sem conclusão', valor: 'CANCELADA,EXPIRADA' },
  { rotulo: 'Todos', valor: '' },
];

export function Atendimentos() {
  const { usuario } = useAutenticacao();
  const [itens, setItens] = useState<ItemListaSessao[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [status, setStatus] = useState(FILTROS[0].valor);
  const [busca, setBusca] = useState('');
  const [minhas, setMinhas] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const porPagina = 20;

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const parametros = new URLSearchParams();
      if (status) parametros.set('status', status);
      if (busca.trim()) parametros.set('busca', busca.trim());
      if (minhas) parametros.set('minhas', 'true');
      parametros.set('pagina', String(pagina));
      parametros.set('porPagina', String(porPagina));

      const resposta = await api.get<{
        itens: ItemListaSessao[];
        paginacao: { total: number };
      }>(`/sessoes?${parametros.toString()}`);
      setItens(resposta.itens);
      setTotal(resposta.paginacao.total);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [status, busca, minhas, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const paginas = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-detran-900">Atendimentos</h1>
          <p className="text-sm text-slate-500">
            {total} registro(s) {minhas ? 'sob sua responsabilidade' : 'no seu escopo de acesso'}.
          </p>
        </div>
        <Link to="/app/novo" className="botao-primario">
          Novo atendimento
        </Link>
      </div>

      <div className="cartao cartao-corpo space-y-3">
        <div className="flex flex-wrap gap-2">
          {FILTROS.map((filtro) => (
            <button
              key={filtro.rotulo}
              type="button"
              onClick={() => {
                setStatus(filtro.valor);
                setPagina(1);
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                status === filtro.valor
                  ? 'bg-detran-700 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {filtro.rotulo}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            className="campo max-w-xs"
            placeholder="Buscar por nome ou código"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(1);
            }}
          />
          {usuario?.perfil !== 'ATENDENTE' && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={minhas}
                onChange={(e) => {
                  setMinhas(e.target.checked);
                  setPagina(1);
                }}
              />
              Somente os meus atendimentos
            </label>
          )}
        </div>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      <div className="cartao overflow-hidden">
        {carregando ? (
          <Carregando />
        ) : !itens.length ? (
          <div className="p-5">
            <Vazio titulo="Nenhum atendimento encontrado" descricao="Ajuste os filtros ou crie um novo atendimento." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Cidadão</th>
                  <th>Código</th>
                  <th>Serviço</th>
                  <th>Atendente</th>
                  <th>Documentos</th>
                  <th>Situação</th>
                  <th>Criado em</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {itens.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td>
                      <p className="font-medium text-slate-800">{item.cidadaoNome}</p>
                      <p className="font-mono text-xs text-slate-400">{item.cpfMascarado}</p>
                    </td>
                    <td className="font-mono text-xs">{item.codigoCurto}</td>
                    <td>{item.tipoAtendimento}</td>
                    <td className="text-slate-500">
                      {item.atendenteNome}
                      <span className="block text-xs text-slate-400">
                        {item.unidadeSigla}
                        {item.guiche ? ` · ${item.guiche}` : ''}
                      </span>
                    </td>
                    <td>
                      {item.documentos.enviados}/{item.documentos.total}
                      <span className="block text-xs text-emerald-600">{item.documentos.aprovados} aprovados</span>
                    </td>
                    <td>
                      <EtiquetaSessao status={item.status} />
                    </td>
                    <td className="whitespace-nowrap text-slate-500">{formatarDataHora(item.criadoEm)}</td>
                    <td className="text-right">
                      <Link to={`/app/atendimentos/${item.id}`} className="link text-sm">
                        Abrir
                      </Link>
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
          <button
            type="button"
            className="botao-neutro"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
          >
            Anterior
          </button>
          <span className="text-slate-500">
            Página {pagina} de {paginas}
          </span>
          <button
            type="button"
            className="botao-neutro"
            disabled={pagina >= paginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
