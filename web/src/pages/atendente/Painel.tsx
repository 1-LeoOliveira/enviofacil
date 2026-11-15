import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { api } from '../../lib/api';
import { useAutenticacao } from '../../lib/autenticacao';
import { formatarDataHora } from '../../lib/formato';
import { conectar } from '../../lib/socket';
import type { ResumoPainel } from '../../lib/tipos';
import { Alerta, Carregando, EtiquetaSessao, Indicador, Vazio } from '../../components/ui';

export function Painel() {
  const { usuario, token } = useAutenticacao();
  const [resumo, setResumo] = useState<ResumoPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const carregar = useCallback(async () => {
    try {
      setResumo(await api.get<ResumoPainel>('/painel'));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Tempo real: qualquer movimentação nas sessões do atendente atualiza o painel.
  useEffect(() => {
    if (!token) return;
    const socket = conectar(token, 'servidor');
    socketRef.current = socket;
    socket.on('painel:evento', (evento: { mensagem?: string }) => {
      if (evento.mensagem) setAviso(evento.mensagem);
      void carregar();
    });
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [token, carregar]);

  if (!resumo && !erro) return <Carregando texto="Carregando painel..." />;

  const i = resumo?.indicadores;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-detran-900">
            Olá, {usuario?.nome.split(' ')[0]}
          </h1>
          <p className="text-sm text-slate-500">
            {usuario?.unidade?.nome ?? 'Unidade não vinculada'}
            {usuario?.guiche ? ` · ${usuario.guiche.identificacao}` : ''}
          </p>
        </div>
        <Link to="/app/novo" className="botao-primario botao-grande">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Novo atendimento
        </Link>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {aviso && (
        <Alerta
          tipo="info"
          acao={
            <button type="button" className="text-xs font-semibold underline" onClick={() => setAviso(null)}>
              ok
            </button>
          }
        >
          {aviso}
        </Alerta>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Em andamento" valor={i?.emAndamento ?? 0} destaque detalhe="sessões abertas" />
        <Indicador rotulo="Aguardando acesso" valor={i?.aguardandoAcesso ?? 0} detalhe="QR ainda não lido" />
        <Indicador rotulo="Aguardando documentos" valor={i?.aguardandoDocumentos ?? 0} detalhe="cidadão conectado" />
        <Indicador rotulo="Para conferir" valor={i?.aguardandoAnalise ?? 0} detalhe="documentos enviados" />
        <Indicador rotulo="Documentos recebidos" valor={i?.arquivosRecebidos ?? 0} detalhe={`${i?.arquivosRecebidosHoje ?? 0} hoje`} />
        <Indicador rotulo="Concluídos hoje" valor={i?.concluidasHoje ?? 0} />
        <Indicador rotulo="Cancelados hoje" valor={i?.canceladasHoje ?? 0} />
      </div>

      <section className="cartao">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
          <h2 className="titulo-secao">Atendimentos recentes</h2>
          <Link to="/app/atendimentos" className="link text-sm">
            Ver todos
          </Link>
        </div>

        {!resumo?.recentes.length ? (
          <div className="p-4 sm:p-5">
            <Vazio
              titulo="Nenhum atendimento ainda"
              descricao="Clique em “Novo atendimento” para identificar o cidadão e gerar o QR Code de envio."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Cidadão</th>
                  <th>Serviço</th>
                  <th>Documentos</th>
                  <th>Situação</th>
                  <th>Início</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {resumo.recentes.map((sessao) => (
                  <tr key={sessao.id} className="hover:bg-slate-50">
                    <td className="font-medium text-slate-800">{sessao.cidadaoNome}</td>
                    <td>{sessao.tipoAtendimento}</td>
                    <td>
                      {sessao.enviados}/{sessao.total}
                    </td>
                    <td>
                      <EtiquetaSessao status={sessao.status} />
                    </td>
                    <td className="whitespace-nowrap text-slate-500">{formatarDataHora(sessao.criadoEm)}</td>
                    <td className="text-right">
                      <Link to={`/app/atendimentos/${sessao.id}`} className="link text-sm">
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
