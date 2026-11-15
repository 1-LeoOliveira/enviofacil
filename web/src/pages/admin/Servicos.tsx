import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAutenticacao } from '../../lib/autenticacao';
import { Alerta, Carregando, Modal, Vazio } from '../../components/ui';

interface TipoAdmin {
  id: number;
  codigo: string;
  nome: string;
  descricao: string | null;
  categoria: 'VEICULO' | 'HABILITACAO' | 'ADMINISTRATIVO';
  ordem: number;
  ativo: number;
  documentos: number;
  sessoes: number;
}

interface DocumentoAdmin {
  id: number;
  nome: string;
  descricao: string | null;
  obrigatorio: number;
  ordem: number;
  ativo: number;
}

const CATEGORIAS = [
  { valor: 'VEICULO', rotulo: 'Veículo' },
  { valor: 'HABILITACAO', rotulo: 'Habilitação' },
  { valor: 'ADMINISTRATIVO', rotulo: 'Administrativo' },
] as const;

export function Servicos() {
  const { usuario } = useAutenticacao();
  const podeEditar = usuario?.perfil === 'ADMIN';

  const [tipos, setTipos] = useState<TipoAdmin[]>([]);
  const [selecionado, setSelecionado] = useState<TipoAdmin | null>(null);
  const [documentos, setDocumentos] = useState<DocumentoAdmin[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [modalTipo, setModalTipo] = useState<{ aberto: boolean; edicao: TipoAdmin | null }>({
    aberto: false,
    edicao: null,
  });
  const [formTipo, setFormTipo] = useState({
    codigo: '',
    nome: '',
    descricao: '',
    categoria: 'ADMINISTRATIVO' as TipoAdmin['categoria'],
    ordem: 0,
    ativo: true,
  });

  const [modalDoc, setModalDoc] = useState<{ aberto: boolean; edicao: DocumentoAdmin | null }>({
    aberto: false,
    edicao: null,
  });
  const [formDoc, setFormDoc] = useState({
    nome: '',
    descricao: '',
    obrigatorio: true,
    ordem: 0,
    ativo: true,
  });

  const carregarTipos = useCallback(async () => {
    setCarregando(true);
    try {
      const resposta = await api.get<{ tipos: TipoAdmin[] }>('/admin/tipos-atendimento');
      setTipos(resposta.tipos);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  const carregarDocumentos = useCallback(async (tipoId: number) => {
    try {
      const resposta = await api.get<{ documentos: DocumentoAdmin[] }>(
        `/admin/tipos-atendimento/${tipoId}/documentos`,
      );
      setDocumentos(resposta.documentos);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void carregarTipos();
  }, [carregarTipos]);

  useEffect(() => {
    if (selecionado) void carregarDocumentos(selecionado.id);
  }, [selecionado, carregarDocumentos]);

  async function salvarTipo() {
    setErro(null);
    try {
      const corpo = {
        codigo: formTipo.codigo.trim().toUpperCase(),
        nome: formTipo.nome.trim(),
        descricao: formTipo.descricao.trim() || undefined,
        categoria: formTipo.categoria,
        ordem: Number(formTipo.ordem) || 0,
        ativo: formTipo.ativo,
      };
      if (modalTipo.edicao) {
        await api.put(`/admin/tipos-atendimento/${modalTipo.edicao.id}`, corpo);
      } else {
        await api.post('/admin/tipos-atendimento', corpo);
      }
      setModalTipo({ aberto: false, edicao: null });
      setAviso('Serviço salvo.');
      await carregarTipos();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function salvarDocumento() {
    if (!selecionado) return;
    setErro(null);
    try {
      const corpo = {
        nome: formDoc.nome.trim(),
        descricao: formDoc.descricao.trim() || undefined,
        obrigatorio: formDoc.obrigatorio,
        ordem: Number(formDoc.ordem) || 0,
        ativo: formDoc.ativo,
      };
      if (modalDoc.edicao) {
        await api.put(`/admin/documentos-exigidos/${modalDoc.edicao.id}`, corpo);
      } else {
        await api.post(`/admin/tipos-atendimento/${selecionado.id}/documentos`, corpo);
      }
      setModalDoc({ aberto: false, edicao: null });
      setAviso('Documento salvo.');
      await carregarDocumentos(selecionado.id);
      await carregarTipos();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function reordenar(indice: number, direcao: -1 | 1) {
    if (!selecionado) return;
    const nova = [...documentos];
    const destino = indice + direcao;
    if (destino < 0 || destino >= nova.length) return;
    [nova[indice], nova[destino]] = [nova[destino], nova[indice]];
    setDocumentos(nova);
    try {
      await api.post(`/admin/tipos-atendimento/${selecionado.id}/documentos/ordenar`, {
        ordem: nova.map((d) => d.id),
      });
    } catch (e) {
      setErro((e as Error).message);
      await carregarDocumentos(selecionado.id);
    }
  }

  if (carregando) return <Carregando texto="Carregando catálogo..." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-detran-900">Serviços e documentos</h1>
          <p className="text-sm text-slate-500">
            Catálogo de atendimentos e documentos exigidos em cada serviço.
          </p>
        </div>
        {podeEditar && (
          <button
            type="button"
            className="botao-primario"
            onClick={() => {
              setFormTipo({ codigo: '', nome: '', descricao: '', categoria: 'ADMINISTRATIVO', ordem: (tipos.length + 1) * 10, ativo: true });
              setModalTipo({ aberto: true, edicao: null });
            }}
          >
            Novo serviço
          </button>
        )}
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {aviso && (
        <Alerta tipo="sucesso" acao={<button type="button" className="text-xs underline" onClick={() => setAviso(null)}>ok</button>}>
          {aviso}
        </Alerta>
      )}
      {!podeEditar && <Alerta tipo="info">Seu perfil permite apenas consulta do catálogo.</Alerta>}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="cartao overflow-hidden lg:col-span-3">
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th>Categoria</th>
                  <th>Documentos</th>
                  <th>Sessões</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tipos.map((tipo) => (
                  <tr
                    key={tipo.id}
                    className={`cursor-pointer hover:bg-slate-50 ${selecionado?.id === tipo.id ? 'bg-detran-50' : ''}`}
                    onClick={() => setSelecionado(tipo)}
                  >
                    <td>
                      <p className="font-medium text-slate-800">{tipo.nome}</p>
                      <p className="font-mono text-xs text-slate-400">{tipo.codigo}</p>
                    </td>
                    <td className="text-slate-600">
                      {CATEGORIAS.find((c) => c.valor === tipo.categoria)?.rotulo}
                    </td>
                    <td>{tipo.documentos}</td>
                    <td className="text-slate-500">{tipo.sessoes}</td>
                    <td>
                      <span className={`etiqueta ${tipo.ativo ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                        {tipo.ativo ? 'ativo' : 'inativo'}
                      </span>
                    </td>
                    <td className="text-right">
                      {podeEditar && (
                        <button
                          type="button"
                          className="link text-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFormTipo({
                              codigo: tipo.codigo,
                              nome: tipo.nome,
                              descricao: tipo.descricao ?? '',
                              categoria: tipo.categoria,
                              ordem: tipo.ordem,
                              ativo: tipo.ativo === 1,
                            });
                            setModalTipo({ aberto: true, edicao: tipo });
                          }}
                        >
                          Editar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="cartao cartao-corpo lg:col-span-2">
          {!selecionado ? (
            <Vazio titulo="Selecione um serviço" descricao="Escolha um serviço na lista para ver e editar os documentos exigidos." />
          ) : (
            <>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="titulo-secao">{selecionado.nome}</h2>
                  <p className="text-xs text-slate-500">{documentos.length} documento(s) cadastrado(s)</p>
                </div>
                {podeEditar && (
                  <button
                    type="button"
                    className="botao-secundario px-3 py-1.5 text-xs"
                    onClick={() => {
                      setFormDoc({ nome: '', descricao: '', obrigatorio: true, ordem: (documentos.length + 1) * 10, ativo: true });
                      setModalDoc({ aberto: true, edicao: null });
                    }}
                  >
                    Adicionar
                  </button>
                )}
              </div>

              <ul className="space-y-2">
                {documentos.map((documento, indice) => (
                  <li
                    key={documento.id}
                    className={`rounded-lg border px-3 py-2 ${documento.ativo ? 'border-slate-200' : 'border-slate-200 bg-slate-50 opacity-60'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{documento.nome}</p>
                        {documento.descricao && <p className="text-xs text-slate-500">{documento.descricao}</p>}
                        <span className={`mt-1 inline-block text-[11px] font-semibold ${documento.obrigatorio ? 'text-detran-700' : 'text-slate-400'}`}>
                          {documento.obrigatorio ? 'obrigatório' : 'opcional'}
                        </span>
                      </div>
                      {podeEditar && (
                        <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                          <div className="flex gap-1">
                            <button type="button" className="rounded border border-slate-200 px-1.5" onClick={() => void reordenar(indice, -1)} aria-label="Subir">
                              ↑
                            </button>
                            <button type="button" className="rounded border border-slate-200 px-1.5" onClick={() => void reordenar(indice, 1)} aria-label="Descer">
                              ↓
                            </button>
                          </div>
                          <button
                            type="button"
                            className="link"
                            onClick={() => {
                              setFormDoc({
                                nome: documento.nome,
                                descricao: documento.descricao ?? '',
                                obrigatorio: documento.obrigatorio === 1,
                                ordem: documento.ordem,
                                ativo: documento.ativo === 1,
                              });
                              setModalDoc({ aberto: true, edicao: documento });
                            }}
                          >
                            editar
                          </button>
                          {documento.ativo === 1 && (
                            <button
                              type="button"
                              className="text-rose-600 hover:underline"
                              onClick={() => {
                                if (confirm('Desativar este documento do serviço?')) {
                                  void api
                                    .delete(`/admin/documentos-exigidos/${documento.id}`)
                                    .then(() => carregarDocumentos(selecionado.id))
                                    .then(() => carregarTipos())
                                    .catch((e: Error) => setErro(e.message));
                                }
                              }}
                            >
                              desativar
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <Modal
        aberto={modalTipo.aberto}
        titulo={modalTipo.edicao ? 'Editar serviço' : 'Novo serviço'}
        aoFechar={() => setModalTipo({ aberto: false, edicao: null })}
      >
        <div className="space-y-3">
          <div>
            <label className="rotulo">Código interno</label>
            <input
              className="campo font-mono"
              value={formTipo.codigo}
              onChange={(e) => setFormTipo({ ...formTipo, codigo: e.target.value.toUpperCase() })}
              placeholder="TRANSFERENCIA_PROPRIEDADE"
            />
          </div>
          <div>
            <label className="rotulo">Nome do serviço</label>
            <input className="campo" value={formTipo.nome} onChange={(e) => setFormTipo({ ...formTipo, nome: e.target.value })} />
          </div>
          <div>
            <label className="rotulo">Descrição</label>
            <textarea className="campo" rows={2} value={formTipo.descricao} onChange={(e) => setFormTipo({ ...formTipo, descricao: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="rotulo">Categoria</label>
              <select
                className="campo"
                value={formTipo.categoria}
                onChange={(e) => setFormTipo({ ...formTipo, categoria: e.target.value as TipoAdmin['categoria'] })}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.rotulo}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="rotulo">Ordem</label>
              <input
                type="number"
                className="campo"
                value={formTipo.ordem}
                onChange={(e) => setFormTipo({ ...formTipo, ordem: Number(e.target.value) })}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={formTipo.ativo} onChange={(e) => setFormTipo({ ...formTipo, ativo: e.target.checked })} />
            Serviço disponível para novos atendimentos
          </label>
          <button type="button" className="botao-primario w-full" onClick={() => void salvarTipo()}>
            Salvar serviço
          </button>
        </div>
      </Modal>

      <Modal
        aberto={modalDoc.aberto}
        titulo={modalDoc.edicao ? 'Editar documento' : 'Novo documento exigido'}
        aoFechar={() => setModalDoc({ aberto: false, edicao: null })}
      >
        <div className="space-y-3">
          <div>
            <label className="rotulo">Nome</label>
            <input className="campo" value={formDoc.nome} onChange={(e) => setFormDoc({ ...formDoc, nome: e.target.value })} />
          </div>
          <div>
            <label className="rotulo">Orientação ao cidadão</label>
            <textarea className="campo" rows={2} value={formDoc.descricao} onChange={(e) => setFormDoc({ ...formDoc, descricao: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={formDoc.obrigatorio} onChange={(e) => setFormDoc({ ...formDoc, obrigatorio: e.target.checked })} />
              Obrigatório
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={formDoc.ativo} onChange={(e) => setFormDoc({ ...formDoc, ativo: e.target.checked })} />
              Ativo
            </label>
          </div>
          <button type="button" className="botao-primario w-full" onClick={() => void salvarDocumento()}>
            Salvar documento
          </button>
        </div>
      </Modal>
    </div>
  );
}
