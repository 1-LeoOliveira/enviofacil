import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { api, baixarArquivo } from '../../lib/api';
import { useAutenticacao } from '../../lib/autenticacao';
import { formatarDataHora, formatarHora, formatarTamanho, tempoRestante } from '../../lib/formato';
import { conectar, type EventoTempoReal } from '../../lib/socket';
import type { AcessoSessao, DetalheSessao, DocumentoSessao } from '../../lib/tipos';
import {
  Alerta,
  BarraProgresso,
  Carregando,
  EtiquetaDocumento,
  EtiquetaSessao,
  Modal,
  Vazio,
} from '../../components/ui';
import { VisualizadorArquivo } from '../../components/VisualizadorArquivo';

export function PainelRecebimento() {
  const { id = '' } = useParams();
  const { token, usuario } = useAutenticacao();

  const [detalhe, setDetalhe] = useState<DetalheSessao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [arquivoAberto, setArquivoAberto] = useState<{ id: string; nome: string } | null>(null);
  const [acesso, setAcesso] = useState<AcessoSessao | null>(null);
  const [cpfRevelado, setCpfRevelado] = useState<string | null>(null);

  const [rejeicao, setRejeicao] = useState<DocumentoSessao | null>(null);
  const [motivo, setMotivo] = useState('');
  const [solicitarNovo, setSolicitarNovo] = useState(true);

  const [orientacaoDoc, setOrientacaoDoc] = useState<DocumentoSessao | null>(null);
  const [textoOrientacao, setTextoOrientacao] = useState('');

  const [docExtra, setDocExtra] = useState(false);
  const [extraNome, setExtraNome] = useState('');
  const [extraDescricao, setExtraDescricao] = useState('');

  const [tituloArquivo, setTituloArquivo] = useState('');
  const [descricaoArquivo, setDescricaoArquivo] = useState('');
  const entradaArquivo = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDetalhe(await api.get<DetalheSessao>(`/sessoes/${id}`));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Tempo real: entra na sala da sessão e recarrega a cada evento relevante.
  useEffect(() => {
    if (!token || !id) return;
    const socket = conectar(token, 'servidor');
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('acompanhar-sessao', id));
    socket.on('sessao:evento', (evento: EventoTempoReal) => {
      if (evento.sessaoId !== id) return;
      if (evento.mensagem) setAviso(evento.mensagem);
      void carregar();
    });
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [token, id, carregar]);

  // Rede do guichê pode oscilar: uma atualização periódica garante consistência.
  useEffect(() => {
    const intervalo = setInterval(() => void carregar(), 30_000);
    return () => clearInterval(intervalo);
  }, [carregar]);

  async function acao<T>(executar: () => Promise<T>, mensagemSucesso?: string) {
    setOcupado(true);
    setErro(null);
    try {
      await executar();
      await carregar();
      if (mensagemSucesso) setAviso(mensagemSucesso);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function mostrarAcesso() {
    try {
      const resposta = await api.get<{ acesso: AcessoSessao }>(`/sessoes/${id}/acesso`);
      setAcesso(resposta.acesso);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function enviarArquivoAtendente(evento: React.FormEvent) {
    evento.preventDefault();
    const arquivo = entradaArquivo.current?.files?.[0];
    if (!arquivo) {
      setErro('Selecione o arquivo que será disponibilizado ao cidadão.');
      return;
    }
    if (tituloArquivo.trim().length < 3) {
      setErro('Informe um título com pelo menos 3 caracteres.');
      return;
    }
    const formulario = new FormData();
    formulario.append('arquivo', arquivo);
    formulario.append('titulo', tituloArquivo.trim());
    if (descricaoArquivo.trim()) formulario.append('descricao', descricaoArquivo.trim());

    await acao(async () => {
      await api.enviarArquivo(`/sessoes/${id}/arquivos`, formulario);
      setTituloArquivo('');
      setDescricaoArquivo('');
      if (entradaArquivo.current) entradaArquivo.current.value = '';
    }, 'Arquivo disponibilizado ao cidadão.');
  }

  if (!detalhe && !erro) return <Carregando texto="Abrindo atendimento..." />;
  if (!detalhe) {
    return (
      <div className="space-y-4">
        <Alerta tipo="erro">{erro}</Alerta>
        <Link to="/app/atendimentos" className="link">
          Voltar para a lista de atendimentos
        </Link>
      </div>
    );
  }

  const { sessao, documentos, progresso, arquivosDoAtendente, eventos } = detalhe;
  const encerrada = ['CONCLUIDA', 'CANCELADA', 'EXPIRADA'].includes(sessao.status);
  const souResponsavel = usuario?.id === sessao.atendente.id || usuario?.perfil === 'ADMIN';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-bold text-detran-900">{sessao.cidadaoNome}</h1>
            <EtiquetaSessao status={sessao.status} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
            <span className="font-mono">{cpfRevelado ?? sessao.cpfMascarado}</span>
            {!cpfRevelado && (
              <button
                type="button"
                className="text-xs font-semibold text-detran-700 underline"
                onClick={() =>
                  void acao(async () => {
                    const r = await api.post<{ cpf: string }>(`/sessoes/${id}/revelar-cpf`);
                    setCpfRevelado(r.cpf);
                  })
                }
              >
                revelar CPF
              </button>
            )}
            <span>·</span>
            <span>{sessao.tipoAtendimento.nome}</span>
            <span>·</span>
            <span>
              {sessao.unidade.sigla}
              {sessao.guiche ? ` · ${sessao.guiche.identificacao}` : ''}
            </span>
            <span>·</span>
            <span>{formatarDataHora(sessao.criadoEm)}</span>
            {!encerrada && <span className="font-medium text-amber-700">· {tempoRestante(sessao.expiraEm)}</span>}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="botao-secundario" onClick={() => void mostrarAcesso()}>
            Mostrar QR Code
          </button>
          {souResponsavel && !encerrada && (
            <>
              <button
                type="button"
                className="botao-neutro"
                disabled={ocupado}
                onClick={() => void acao(() => api.post(`/sessoes/${id}/prorrogar`), 'Prazo prorrogado.')}
              >
                Prorrogar prazo
              </button>
              <button
                type="button"
                className="botao-sucesso"
                disabled={ocupado}
                onClick={() => {
                  if (confirm('Concluir este atendimento? O cidadão perderá o acesso à sessão.')) {
                    void acao(() => api.post(`/sessoes/${id}/encerrar`, {}), 'Atendimento concluído.');
                  }
                }}
              >
                Concluir atendimento
              </button>
              <button
                type="button"
                className="botao-perigo"
                disabled={ocupado}
                onClick={() => {
                  const razao = prompt('Informe o motivo do cancelamento:');
                  if (razao && razao.trim().length >= 3) {
                    void acao(() => api.post(`/sessoes/${id}/cancelar`, { motivo: razao.trim() }), 'Sessão cancelada.');
                  }
                }}
              >
                Cancelar
              </button>
            </>
          )}
        </div>
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
      {sessao.status === 'AGUARDANDO' && (
        <Alerta tipo="atencao" titulo="Aguardando o cidadão">
          O QR Code ainda não foi lido. Mostre o código ao cidadão para iniciar o envio.
        </Alerta>
      )}
      {encerrada && (
        <Alerta tipo="info" titulo={`Sessão ${sessao.status.toLowerCase()}`}>
          {sessao.motivoEncerramento ?? 'Esta sessão não aceita mais alterações.'}
        </Alerta>
      )}

      <div className="cartao cartao-corpo">
        <BarraProgresso
          valor={progresso.enviados}
          total={progresso.total}
          rotulo="Documentos recebidos"
        />
        <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-2">
            <p className="text-lg font-bold text-slate-700">{progresso.pendentes}</p>
            <p className="text-slate-500">pendentes</p>
          </div>
          <div className="rounded-lg bg-indigo-50 p-2">
            <p className="text-lg font-bold text-indigo-700">{progresso.enviados}</p>
            <p className="text-indigo-600">enviados</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-2">
            <p className="text-lg font-bold text-emerald-700">{progresso.aprovados}</p>
            <p className="text-emerald-600">aprovados</p>
          </div>
          <div className="rounded-lg bg-rose-50 p-2">
            <p className="text-lg font-bold text-rose-700">{progresso.rejeitados}</p>
            <p className="text-rose-600">rejeitados</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="titulo-secao">Documentos solicitados</h2>
            {souResponsavel && !encerrada && (
              <button type="button" className="botao-secundario" onClick={() => setDocExtra(true)}>
                Solicitar outro documento
              </button>
            )}
          </div>

          {documentos.map((documento) => (
            <article key={documento.id} className="cartao cartao-corpo">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-800">{documento.nome}</h3>
                    {documento.obrigatorio ? (
                      <span className="etiqueta bg-slate-100 text-slate-600">obrigatório</span>
                    ) : (
                      <span className="etiqueta bg-slate-50 text-slate-500">opcional</span>
                    )}
                    {documento.extra && <span className="etiqueta bg-detran-50 text-detran-700">adicional</span>}
                  </div>
                  {documento.descricao && <p className="mt-1 text-sm text-slate-500">{documento.descricao}</p>}
                </div>
                <EtiquetaDocumento status={documento.status} />
              </div>

              {documento.motivoRejeicao && (
                <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  <span className="font-semibold">Motivo informado ao cidadão:</span> {documento.motivoRejeicao}
                </p>
              )}
              {documento.orientacao && (
                <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
                  <span className="font-semibold">Orientação:</span> {documento.orientacao}
                </p>
              )}

              {documento.arquivos.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {documento.arquivos.map((arquivo) => (
                    <li
                      key={arquivo.id}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                        arquivo.substituido ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-slate-200'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-700">{arquivo.nomeOriginal}</p>
                        <p className="text-xs text-slate-500">
                          {formatarTamanho(arquivo.tamanhoBytes)} ·{' '}
                          {arquivo.enviadoEm ? `enviado ${formatarHora(arquivo.enviadoEm)}` : 'ainda não enviado'}
                          {arquivo.substituido ? ' · substituído' : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="botao-neutro px-3 py-1.5 text-xs"
                          onClick={() => setArquivoAberto({ id: arquivo.id, nome: arquivo.nomeOriginal })}
                        >
                          Visualizar
                        </button>
                        <button
                          type="button"
                          className="botao-neutro px-3 py-1.5 text-xs"
                          onClick={() => void baixarArquivo(arquivo.id, 'servidor')}
                        >
                          Baixar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  Nenhum arquivo recebido para este documento.
                </p>
              )}

              {souResponsavel && !encerrada && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    className="botao-sucesso px-3 py-1.5 text-xs"
                    disabled={ocupado || !['ENVIADO', 'EM_ANALISE', 'REJEITADO'].includes(documento.status)}
                    onClick={() =>
                      void acao(
                        () => api.post(`/sessoes/${id}/documentos/${documento.id}/aprovar`),
                        `Documento aprovado: ${documento.nome}.`,
                      )
                    }
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    className="botao-perigo px-3 py-1.5 text-xs"
                    disabled={ocupado || documento.status === 'PENDENTE'}
                    onClick={() => {
                      setRejeicao(documento);
                      setMotivo('');
                      setSolicitarNovo(true);
                    }}
                  >
                    Rejeitar / pedir correção
                  </button>
                  <button
                    type="button"
                    className="botao-neutro px-3 py-1.5 text-xs"
                    onClick={() => {
                      setOrientacaoDoc(documento);
                      setTextoOrientacao(documento.orientacao ?? '');
                    }}
                  >
                    Adicionar orientação
                  </button>
                  {documento.extra && documento.status === 'PENDENTE' && (
                    <button
                      type="button"
                      className="botao-neutro px-3 py-1.5 text-xs"
                      onClick={() =>
                        void acao(
                          () => api.delete(`/sessoes/${id}/documentos/${documento.id}`),
                          'Documento removido da sessão.',
                        )
                      }
                    >
                      Remover
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>

        <aside className="space-y-4">
          <section className="cartao cartao-corpo">
            <h2 className="titulo-secao">Enviar ao cidadão</h2>
            <p className="mt-1 text-sm text-slate-500">
              Comprovantes, recibos e orientações ficam disponíveis no celular do cidadão.
            </p>

            {souResponsavel && !encerrada && (
              <form onSubmit={enviarArquivoAtendente} className="mt-3 space-y-2">
                <input
                  className="campo"
                  placeholder="Título (ex.: Comprovante de protocolo)"
                  value={tituloArquivo}
                  onChange={(e) => setTituloArquivo(e.target.value)}
                  maxLength={140}
                />
                <input
                  className="campo"
                  placeholder="Descrição (opcional)"
                  value={descricaoArquivo}
                  onChange={(e) => setDescricaoArquivo(e.target.value)}
                  maxLength={400}
                />
                <input
                  ref={entradaArquivo}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  className="campo file:mr-3 file:rounded file:border-0 file:bg-detran-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-detran-700"
                />
                <button type="submit" className="botao-primario w-full" disabled={ocupado}>
                  Disponibilizar arquivo
                </button>
              </form>
            )}

            {arquivosDoAtendente.length ? (
              <ul className="mt-4 space-y-2">
                {arquivosDoAtendente.map((arquivo) => (
                  <li key={arquivo.id} className="rounded-lg border border-slate-200 px-3 py-2">
                    <p className="text-sm font-medium text-slate-700">{arquivo.titulo ?? arquivo.nomeOriginal}</p>
                    {arquivo.descricao && <p className="text-xs text-slate-500">{arquivo.descricao}</p>}
                    <p className="mt-0.5 text-xs text-slate-400">
                      {formatarTamanho(arquivo.tamanhoBytes)} · {formatarDataHora(arquivo.criadoEm)}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className="botao-neutro px-3 py-1 text-xs"
                        onClick={() => setArquivoAberto({ id: arquivo.id, nome: arquivo.nomeOriginal })}
                      >
                        Visualizar
                      </button>
                      {souResponsavel && !encerrada && (
                        <button
                          type="button"
                          className="botao-neutro px-3 py-1 text-xs"
                          onClick={() =>
                            void acao(
                              () => api.delete(`/sessoes/${id}/arquivos/${arquivo.id}`),
                              'Arquivo removido.',
                            )
                          }
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-400">Nenhum arquivo disponibilizado ainda.</p>
            )}
          </section>

          <section className="cartao cartao-corpo">
            <h2 className="titulo-secao">Linha do tempo</h2>
            {eventos.length ? (
              <ol className="mt-3 space-y-3">
                {[...eventos].reverse().map((evento) => (
                  <li key={evento.id} className="border-l-2 border-detran-100 pl-3">
                    <p className="text-sm text-slate-700">{evento.mensagem ?? evento.tipo}</p>
                    <p className="text-xs text-slate-400">
                      {formatarHora(evento.criadoEm)} ·{' '}
                      {evento.ator === 'CIDADAO' ? 'cidadão' : evento.ator === 'ATENDENTE' ? 'atendente' : 'sistema'}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-slate-400">Sem eventos registrados.</p>
            )}
          </section>
        </aside>
      </div>

      {/* Modais */}
      <VisualizadorArquivo
        arquivoId={arquivoAberto?.id ?? null}
        nome={arquivoAberto?.nome}
        escopo="servidor"
        aoFechar={() => setArquivoAberto(null)}
      />

      <Modal aberto={Boolean(acesso)} titulo="Acesso do cidadão" aoFechar={() => setAcesso(null)}>
        {acesso && (
          <div className="space-y-3 text-center">
            <img src={acesso.qrCode} alt="QR Code de acesso" className="mx-auto h-56 w-56 rounded-lg border border-slate-200 p-2" />
            <p className="font-mono text-2xl font-bold tracking-widest text-detran-900">{acesso.codigoCurto}</p>
            <p className="text-sm text-slate-500">
              Validade até{' '}
              {new Date(acesso.expiraEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <button type="button" className="botao-neutro nao-imprimir" onClick={() => window.print()}>
              Imprimir
            </button>
          </div>
        )}
      </Modal>

      <Modal
        aberto={Boolean(rejeicao)}
        titulo={`Rejeitar: ${rejeicao?.nome ?? ''}`}
        aoFechar={() => setRejeicao(null)}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            O motivo abaixo aparece no celular do cidadão. Seja específico para evitar um novo envio incorreto.
          </p>
          <textarea
            className="campo"
            rows={4}
            maxLength={400}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: A imagem está cortada e não permite ler o número do documento."
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={solicitarNovo} onChange={(e) => setSolicitarNovo(e.target.checked)} />
            Solicitar novo envio deste documento
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="botao-primario"
              disabled={ocupado || motivo.trim().length < 10}
              onClick={() =>
                void acao(async () => {
                  await api.post(`/sessoes/${id}/documentos/${rejeicao!.id}/rejeitar`, {
                    motivo: motivo.trim(),
                    solicitarNovoEnvio: solicitarNovo,
                  });
                  setRejeicao(null);
                }, 'Rejeição registrada e informada ao cidadão.')
              }
            >
              Confirmar rejeição
            </button>
            <button type="button" className="botao-neutro" onClick={() => setRejeicao(null)}>
              Cancelar
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        aberto={Boolean(orientacaoDoc)}
        titulo={`Orientação: ${orientacaoDoc?.nome ?? ''}`}
        aoFechar={() => setOrientacaoDoc(null)}
      >
        <div className="space-y-3">
          <textarea
            className="campo"
            rows={4}
            maxLength={400}
            value={textoOrientacao}
            onChange={(e) => setTextoOrientacao(e.target.value)}
            placeholder="Ex.: Fotografe o documento aberto, sobre uma superfície plana, com boa iluminação."
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="botao-primario"
              disabled={ocupado || textoOrientacao.trim().length < 3}
              onClick={() =>
                void acao(async () => {
                  await api.post(`/sessoes/${id}/documentos/${orientacaoDoc!.id}/orientacao`, {
                    orientacao: textoOrientacao.trim(),
                  });
                  setOrientacaoDoc(null);
                }, 'Orientação enviada ao cidadão.')
              }
            >
              Enviar orientação
            </button>
            <button type="button" className="botao-neutro" onClick={() => setOrientacaoDoc(null)}>
              Cancelar
            </button>
          </div>
        </div>
      </Modal>

      <Modal aberto={docExtra} titulo="Solicitar documento adicional" aoFechar={() => setDocExtra(false)}>
        <div className="space-y-3">
          <div>
            <label className="rotulo" htmlFor="extra-nome">
              Nome do documento
            </label>
            <input
              id="extra-nome"
              className="campo"
              value={extraNome}
              onChange={(e) => setExtraNome(e.target.value)}
              maxLength={140}
            />
          </div>
          <div>
            <label className="rotulo" htmlFor="extra-descricao">
              Orientação ao cidadão (opcional)
            </label>
            <input
              id="extra-descricao"
              className="campo"
              value={extraDescricao}
              onChange={(e) => setExtraDescricao(e.target.value)}
              maxLength={400}
            />
          </div>
          <button
            type="button"
            className="botao-primario"
            disabled={ocupado || extraNome.trim().length < 3}
            onClick={() =>
              void acao(async () => {
                await api.post(`/sessoes/${id}/documentos`, {
                  nome: extraNome.trim(),
                  descricao: extraDescricao.trim() || undefined,
                  obrigatorio: false,
                });
                setExtraNome('');
                setExtraDescricao('');
                setDocExtra(false);
              }, 'Documento adicional solicitado.')
            }
          >
            Solicitar documento
          </button>
        </div>
      </Modal>
    </div>
  );
}
