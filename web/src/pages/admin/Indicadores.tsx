import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAutenticacao } from '../../lib/autenticacao';
import { formatarDuracao, formatarTamanho } from '../../lib/formato';
import { Alerta, Carregando, Indicador } from '../../components/ui';

interface RespostaIndicadores {
  sessoes: {
    total: number;
    concluidas: number;
    canceladas: number;
    expiradas: number;
    emAberto: number;
    acessadas: number;
    tempoMedioEnvioSegundos: number;
    tempoMedioAtendimentoSegundos: number;
  };
  documentos: { total: number; enviados: number; aprovados: number; rejeitados: number; pendentes: number };
  arquivos: { doCidadao: number; doAtendente: number; bytes: number };
  porTipo: Array<{ tipo: string; sessoes: number; concluidas: number }>;
  porDia: Array<{ dia: string; sessoes: number; concluidas: number }>;
}

export function Indicadores() {
  const { usuario } = useAutenticacao();
  const [dados, setDados] = useState<RespostaIndicadores | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [unidades, setUnidades] = useState<Array<{ id: number; nome: string }>>([]);
  const [filtros, setFiltros] = useState({ de: '', ate: '', unidadeId: '' });

  const carregar = useCallback(async () => {
    try {
      const parametros = new URLSearchParams();
      if (filtros.de) parametros.set('de', filtros.de);
      if (filtros.ate) parametros.set('ate', filtros.ate);
      if (filtros.unidadeId) parametros.set('unidadeId', filtros.unidadeId);
      setDados(await api.get<RespostaIndicadores>(`/admin/indicadores?${parametros.toString()}`));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [filtros]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    if (usuario?.perfil !== 'ADMIN') return;
    api
      .get<{ unidades: Array<{ id: number; nome: string }> }>('/admin/unidades')
      .then((r) => setUnidades(r.unidades))
      .catch(() => setUnidades([]));
  }, [usuario?.perfil]);

  if (!dados && !erro) return <Carregando texto="Calculando indicadores..." />;

  const maximoDia = Math.max(1, ...(dados?.porDia.map((d) => Number(d.sessoes)) ?? [1]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-detran-900">Indicadores</h1>
        <p className="text-sm text-slate-500">
          {usuario?.perfil === 'SUPERVISOR'
            ? 'Dados restritos à sua unidade de atendimento.'
            : 'Visão consolidada da plataforma.'}
        </p>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      <div className="cartao cartao-corpo flex flex-wrap items-end gap-3">
        <div>
          <label className="rotulo">De</label>
          <input type="date" className="campo" value={filtros.de} onChange={(e) => setFiltros({ ...filtros, de: e.target.value })} />
        </div>
        <div>
          <label className="rotulo">Até</label>
          <input type="date" className="campo" value={filtros.ate} onChange={(e) => setFiltros({ ...filtros, ate: e.target.value })} />
        </div>
        {usuario?.perfil === 'ADMIN' && (
          <div>
            <label className="rotulo">Unidade</label>
            <select className="campo" value={filtros.unidadeId} onChange={(e) => setFiltros({ ...filtros, unidadeId: e.target.value })}>
              <option value="">Todas</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <button type="button" className="botao-neutro" onClick={() => setFiltros({ de: '', ate: '', unidadeId: '' })}>
          Limpar filtros
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Sessões criadas" valor={dados?.sessoes.total ?? 0} destaque />
        <Indicador rotulo="Concluídas" valor={dados?.sessoes.concluidas ?? 0} />
        <Indicador rotulo="Canceladas" valor={dados?.sessoes.canceladas ?? 0} />
        <Indicador rotulo="Expiradas" valor={dados?.sessoes.expiradas ?? 0} />
        <Indicador
          rotulo="Tempo médio de envio"
          valor={formatarDuracao(dados?.sessoes.tempoMedioEnvioSegundos ?? 0)}
          detalhe="da criação ao envio pelo cidadão"
        />
        <Indicador
          rotulo="Tempo médio de atendimento"
          valor={formatarDuracao(dados?.sessoes.tempoMedioAtendimentoSegundos ?? 0)}
          detalhe="da criação ao encerramento"
        />
        <Indicador
          rotulo="Taxa de acesso ao portal"
          valor={`${dados?.sessoes.total ? Math.round(((dados.sessoes.acessadas ?? 0) / dados.sessoes.total) * 100) : 0}%`}
          detalhe="sessões efetivamente abertas pelo cidadão"
        />
        <Indicador rotulo="Sessões em aberto" valor={dados?.sessoes.emAberto ?? 0} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="cartao cartao-corpo">
          <h2 className="titulo-secao mb-3">Documentos</h2>
          <dl className="space-y-2 text-sm">
            {[
              ['Solicitados', dados?.documentos.total ?? 0],
              ['Enviados digitalmente', dados?.documentos.enviados ?? 0],
              ['Aprovados', dados?.documentos.aprovados ?? 0],
              ['Rejeitados / reenvio', dados?.documentos.rejeitados ?? 0],
              ['Nunca enviados', dados?.documentos.pendentes ?? 0],
            ].map(([rotulo, valor]) => (
              <div key={String(rotulo)} className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                <dt className="text-slate-600">{rotulo}</dt>
                <dd className="font-semibold text-slate-800">{valor}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <dt className="text-slate-600">Arquivos armazenados</dt>
              <dd className="font-semibold text-slate-800">
                {(dados?.arquivos.doCidadao ?? 0) + (dados?.arquivos.doAtendente ?? 0)} ·{' '}
                {formatarTamanho(dados?.arquivos.bytes ?? 0)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="cartao cartao-corpo">
          <h2 className="titulo-secao mb-3">Por serviço</h2>
          {dados?.porTipo.length ? (
            <ul className="space-y-2">
              {dados.porTipo.map((item) => (
                <li key={item.tipo}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate text-slate-700">{item.tipo}</span>
                    <span className="ml-2 shrink-0 font-semibold text-slate-800">{item.sessoes}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-detran-500"
                      style={{
                        width: `${Math.round((Number(item.sessoes) / Math.max(1, dados.sessoes.total)) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Nenhuma sessão no período.</p>
          )}
        </section>
      </div>

      <section className="cartao cartao-corpo">
        <h2 className="titulo-secao mb-3">Sessões por dia</h2>
        {dados?.porDia.length ? (
          <div className="flex items-end gap-1.5 overflow-x-auto pb-2">
            {[...dados.porDia].reverse().map((dia) => (
              <div key={dia.dia} className="flex w-10 shrink-0 flex-col items-center gap-1">
                <div
                  className="w-6 rounded-t bg-detran-500"
                  style={{ height: `${Math.max(4, (Number(dia.sessoes) / maximoDia) * 120)}px` }}
                  title={`${dia.sessoes} sessão(ões)`}
                />
                <span className="text-[10px] text-slate-400">
                  {new Date(`${String(dia.dia).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Sem dados no período selecionado.</p>
        )}
      </section>
    </div>
  );
}
