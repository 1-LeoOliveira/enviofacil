import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Alerta, Carregando, Modal } from '../../components/ui';

interface Unidade {
  id: number;
  nome: string;
  sigla: string;
  cidade: string;
  uf: string;
  endereco: string | null;
  ativo: number;
  guiches: number;
  usuarios: number;
}

interface Guiche {
  id: number;
  unidade_id: number;
  identificacao: string;
  descricao: string | null;
  ativo: number;
  unidade_nome: string;
  atendentes: number;
}

export function UnidadesGuiches() {
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [guiches, setGuiches] = useState<Guiche[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [modalUnidade, setModalUnidade] = useState<{ aberto: boolean; edicao: Unidade | null }>({ aberto: false, edicao: null });
  const [formUnidade, setFormUnidade] = useState({ nome: '', sigla: '', cidade: '', uf: 'SC', endereco: '', ativo: true });

  const [modalGuiche, setModalGuiche] = useState<{ aberto: boolean; edicao: Guiche | null }>({ aberto: false, edicao: null });
  const [formGuiche, setFormGuiche] = useState({ unidadeId: 0, identificacao: '', descricao: '', ativo: true });

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [u, g] = await Promise.all([
        api.get<{ unidades: Unidade[] }>('/admin/unidades'),
        api.get<{ guiches: Guiche[] }>('/admin/guiches'),
      ]);
      setUnidades(u.unidades);
      setGuiches(g.guiches);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvarUnidade() {
    setErro(null);
    try {
      const corpo = {
        nome: formUnidade.nome.trim(),
        sigla: formUnidade.sigla.trim().toUpperCase(),
        cidade: formUnidade.cidade.trim(),
        uf: formUnidade.uf.trim().toUpperCase(),
        endereco: formUnidade.endereco.trim() || undefined,
        ativo: formUnidade.ativo,
      };
      if (modalUnidade.edicao) await api.put(`/admin/unidades/${modalUnidade.edicao.id}`, corpo);
      else await api.post('/admin/unidades', corpo);
      setModalUnidade({ aberto: false, edicao: null });
      setAviso('Unidade salva.');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function salvarGuiche() {
    setErro(null);
    try {
      const corpo = {
        unidadeId: formGuiche.unidadeId,
        identificacao: formGuiche.identificacao.trim(),
        descricao: formGuiche.descricao.trim() || undefined,
        ativo: formGuiche.ativo,
      };
      if (modalGuiche.edicao) await api.put(`/admin/guiches/${modalGuiche.edicao.id}`, corpo);
      else await api.post('/admin/guiches', corpo);
      setModalGuiche({ aberto: false, edicao: null });
      setAviso('Guichê salvo.');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (carregando) return <Carregando />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-detran-900">Unidades e guichês</h1>
        <p className="text-sm text-slate-500">
          O isolamento de dados da plataforma usa a unidade como fronteira de acesso.
        </p>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {aviso && (
        <Alerta tipo="sucesso" acao={<button type="button" className="text-xs underline" onClick={() => setAviso(null)}>ok</button>}>
          {aviso}
        </Alerta>
      )}

      <section className="cartao overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="titulo-secao">Unidades</h2>
          <button
            type="button"
            className="botao-primario px-3 py-1.5 text-xs"
            onClick={() => {
              setFormUnidade({ nome: '', sigla: '', cidade: '', uf: 'SC', endereco: '', ativo: true });
              setModalUnidade({ aberto: true, edicao: null });
            }}
          >
            Nova unidade
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Unidade</th>
                <th>Cidade</th>
                <th>Guichês</th>
                <th>Servidores</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {unidades.map((unidade) => (
                <tr key={unidade.id} className="hover:bg-slate-50">
                  <td>
                    <p className="font-medium text-slate-800">{unidade.nome}</p>
                    <p className="text-xs text-slate-400">{unidade.sigla}</p>
                  </td>
                  <td>
                    {unidade.cidade}/{unidade.uf}
                  </td>
                  <td>{unidade.guiches}</td>
                  <td>{unidade.usuarios}</td>
                  <td>
                    <span className={`etiqueta ${unidade.ativo ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                      {unidade.ativo ? 'ativa' : 'inativa'}
                    </span>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="link text-sm"
                      onClick={() => {
                        setFormUnidade({
                          nome: unidade.nome,
                          sigla: unidade.sigla,
                          cidade: unidade.cidade,
                          uf: unidade.uf,
                          endereco: unidade.endereco ?? '',
                          ativo: unidade.ativo === 1,
                        });
                        setModalUnidade({ aberto: true, edicao: unidade });
                      }}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="cartao overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="titulo-secao">Guichês</h2>
          <button
            type="button"
            className="botao-primario px-3 py-1.5 text-xs"
            disabled={!unidades.length}
            onClick={() => {
              setFormGuiche({ unidadeId: unidades[0]?.id ?? 0, identificacao: '', descricao: '', ativo: true });
              setModalGuiche({ aberto: true, edicao: null });
            }}
          >
            Novo guichê
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Guichê</th>
                <th>Unidade</th>
                <th>Atendentes</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {guiches.map((guiche) => (
                <tr key={guiche.id} className="hover:bg-slate-50">
                  <td>
                    <p className="font-medium text-slate-800">{guiche.identificacao}</p>
                    {guiche.descricao && <p className="text-xs text-slate-400">{guiche.descricao}</p>}
                  </td>
                  <td>{guiche.unidade_nome}</td>
                  <td>{guiche.atendentes}</td>
                  <td>
                    <span className={`etiqueta ${guiche.ativo ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                      {guiche.ativo ? 'ativo' : 'inativo'}
                    </span>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="link text-sm"
                      onClick={() => {
                        setFormGuiche({
                          unidadeId: guiche.unidade_id,
                          identificacao: guiche.identificacao,
                          descricao: guiche.descricao ?? '',
                          ativo: guiche.ativo === 1,
                        });
                        setModalGuiche({ aberto: true, edicao: guiche });
                      }}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        aberto={modalUnidade.aberto}
        titulo={modalUnidade.edicao ? 'Editar unidade' : 'Nova unidade'}
        aoFechar={() => setModalUnidade({ aberto: false, edicao: null })}
      >
        <div className="space-y-3">
          <div>
            <label className="rotulo">Nome</label>
            <input className="campo" value={formUnidade.nome} onChange={(e) => setFormUnidade({ ...formUnidade, nome: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="rotulo">Sigla</label>
              <input className="campo" value={formUnidade.sigla} onChange={(e) => setFormUnidade({ ...formUnidade, sigla: e.target.value.toUpperCase() })} />
            </div>
            <div className="col-span-2">
              <label className="rotulo">Cidade</label>
              <input className="campo" value={formUnidade.cidade} onChange={(e) => setFormUnidade({ ...formUnidade, cidade: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="rotulo">Endereço</label>
            <input className="campo" value={formUnidade.endereco} onChange={(e) => setFormUnidade({ ...formUnidade, endereco: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={formUnidade.ativo} onChange={(e) => setFormUnidade({ ...formUnidade, ativo: e.target.checked })} />
            Unidade ativa
          </label>
          <button type="button" className="botao-primario w-full" onClick={() => void salvarUnidade()}>
            Salvar unidade
          </button>
        </div>
      </Modal>

      <Modal
        aberto={modalGuiche.aberto}
        titulo={modalGuiche.edicao ? 'Editar guichê' : 'Novo guichê'}
        aoFechar={() => setModalGuiche({ aberto: false, edicao: null })}
      >
        <div className="space-y-3">
          <div>
            <label className="rotulo">Unidade</label>
            <select
              className="campo"
              value={formGuiche.unidadeId}
              onChange={(e) => setFormGuiche({ ...formGuiche, unidadeId: Number(e.target.value) })}
            >
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="rotulo">Identificação</label>
            <input
              className="campo"
              value={formGuiche.identificacao}
              onChange={(e) => setFormGuiche({ ...formGuiche, identificacao: e.target.value })}
              placeholder="Guichê 04"
            />
          </div>
          <div>
            <label className="rotulo">Descrição</label>
            <input className="campo" value={formGuiche.descricao} onChange={(e) => setFormGuiche({ ...formGuiche, descricao: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={formGuiche.ativo} onChange={(e) => setFormGuiche({ ...formGuiche, ativo: e.target.checked })} />
            Guichê ativo
          </label>
          <button type="button" className="botao-primario w-full" onClick={() => void salvarGuiche()}>
            Salvar guichê
          </button>
        </div>
      </Modal>
    </div>
  );
}
