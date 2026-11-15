import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatarDataHora } from '../../lib/formato';
import type { Perfil } from '../../lib/tipos';
import { Alerta, Carregando, Modal } from '../../components/ui';

interface UsuarioAdmin {
  id: number;
  nome: string;
  email: string;
  matricula: string | null;
  perfil: Perfil;
  unidade_id: number | null;
  guiche_id: number | null;
  ativo: number;
  ultimo_login_em: string | null;
  bloqueado_ate: string | null;
  unidade_nome: string | null;
  guiche_identificacao: string | null;
}

const PERFIS: Array<{ valor: Perfil; rotulo: string; descricao: string }> = [
  { valor: 'ATENDENTE', rotulo: 'Atendente', descricao: 'Cria e conduz os próprios atendimentos.' },
  { valor: 'SUPERVISOR', rotulo: 'Supervisor', descricao: 'Acompanha todos os atendimentos da unidade.' },
  { valor: 'ADMIN', rotulo: 'Administrador', descricao: 'Acesso completo, incluindo configurações e auditoria.' },
];

export function Usuarios() {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [unidades, setUnidades] = useState<Array<{ id: number; nome: string }>>([]);
  const [guiches, setGuiches] = useState<Array<{ id: number; unidade_id: number; identificacao: string }>>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [modal, setModal] = useState<{ aberto: boolean; edicao: UsuarioAdmin | null }>({ aberto: false, edicao: null });
  const [form, setForm] = useState({
    nome: '',
    email: '',
    matricula: '',
    perfil: 'ATENDENTE' as Perfil,
    unidadeId: null as number | null,
    guicheId: null as number | null,
    ativo: true,
    senha: '',
  });

  const [modalSenha, setModalSenha] = useState<UsuarioAdmin | null>(null);
  const [novaSenha, setNovaSenha] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [u, un, g] = await Promise.all([
        api.get<{ usuarios: UsuarioAdmin[] }>('/admin/usuarios'),
        api.get<{ unidades: Array<{ id: number; nome: string }> }>('/admin/unidades'),
        api.get<{ guiches: Array<{ id: number; unidade_id: number; identificacao: string }> }>('/admin/guiches'),
      ]);
      setUsuarios(u.usuarios);
      setUnidades(un.unidades);
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

  async function salvar() {
    setErro(null);
    try {
      const corpo: Record<string, unknown> = {
        nome: form.nome.trim(),
        email: form.email.trim().toLowerCase(),
        matricula: form.matricula.trim() || undefined,
        perfil: form.perfil,
        unidadeId: form.unidadeId,
        guicheId: form.guicheId,
        ativo: form.ativo,
      };
      if (modal.edicao) {
        await api.put(`/admin/usuarios/${modal.edicao.id}`, corpo);
      } else {
        corpo.senha = form.senha;
        await api.post('/admin/usuarios', corpo);
      }
      setModal({ aberto: false, edicao: null });
      setAviso('Usuário salvo.');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function redefinirSenha() {
    if (!modalSenha) return;
    setErro(null);
    try {
      await api.post(`/admin/usuarios/${modalSenha.id}/senha`, { senha: novaSenha });
      setModalSenha(null);
      setNovaSenha('');
      setAviso('Senha provisória definida. O usuário deverá trocá-la no próximo acesso.');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (carregando) return <Carregando />;

  const guichesDaUnidade = guiches.filter((g) => g.unidade_id === form.unidadeId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-detran-900">Usuários e permissões</h1>
          <p className="text-sm text-slate-500">Servidores com acesso à plataforma e seus perfis.</p>
        </div>
        <button
          type="button"
          className="botao-primario"
          onClick={() => {
            setForm({
              nome: '',
              email: '',
              matricula: '',
              perfil: 'ATENDENTE',
              unidadeId: unidades[0]?.id ?? null,
              guicheId: null,
              ativo: true,
              senha: '',
            });
            setModal({ aberto: true, edicao: null });
          }}
        >
          Novo usuário
        </button>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {aviso && (
        <Alerta tipo="sucesso" acao={<button type="button" className="text-xs underline" onClick={() => setAviso(null)}>ok</button>}>
          {aviso}
        </Alerta>
      )}

      <div className="cartao overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Servidor</th>
                <th>Perfil</th>
                <th>Unidade / guichê</th>
                <th>Último acesso</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {usuarios.map((usuario) => (
                <tr key={usuario.id} className="hover:bg-slate-50">
                  <td>
                    <p className="font-medium text-slate-800">{usuario.nome}</p>
                    <p className="text-xs text-slate-400">{usuario.email}</p>
                    {usuario.matricula && <p className="text-xs text-slate-400">matrícula {usuario.matricula}</p>}
                  </td>
                  <td>
                    <span className="etiqueta bg-detran-50 text-detran-700">
                      {PERFIS.find((p) => p.valor === usuario.perfil)?.rotulo}
                    </span>
                  </td>
                  <td className="text-slate-600">
                    {usuario.unidade_nome ?? '—'}
                    {usuario.guiche_identificacao && (
                      <span className="block text-xs text-slate-400">{usuario.guiche_identificacao}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-slate-500">{formatarDataHora(usuario.ultimo_login_em)}</td>
                  <td>
                    <span className={`etiqueta ${usuario.ativo ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                      {usuario.ativo ? 'ativo' : 'inativo'}
                    </span>
                    {usuario.bloqueado_ate && new Date(usuario.bloqueado_ate) > new Date() && (
                      <span className="mt-1 block text-[11px] font-semibold text-rose-600">bloqueado</span>
                    )}
                  </td>
                  <td className="space-x-3 whitespace-nowrap text-right">
                    <button
                      type="button"
                      className="link text-sm"
                      onClick={() => {
                        setForm({
                          nome: usuario.nome,
                          email: usuario.email,
                          matricula: usuario.matricula ?? '',
                          perfil: usuario.perfil,
                          unidadeId: usuario.unidade_id,
                          guicheId: usuario.guiche_id,
                          ativo: usuario.ativo === 1,
                          senha: '',
                        });
                        setModal({ aberto: true, edicao: usuario });
                      }}
                    >
                      Editar
                    </button>
                    <button type="button" className="link text-sm" onClick={() => setModalSenha(usuario)}>
                      Senha
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        aberto={modal.aberto}
        titulo={modal.edicao ? 'Editar usuário' : 'Novo usuário'}
        aoFechar={() => setModal({ aberto: false, edicao: null })}
      >
        <div className="space-y-3">
          <div>
            <label className="rotulo">Nome completo</label>
            <input className="campo" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="rotulo">E-mail institucional</label>
              <input className="campo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="rotulo">Matrícula</label>
              <input className="campo" value={form.matricula} onChange={(e) => setForm({ ...form, matricula: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="rotulo">Perfil de acesso</label>
            <div className="space-y-2">
              {PERFIS.map((perfil) => (
                <label
                  key={perfil.valor}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-2.5 ${
                    form.perfil === perfil.valor ? 'border-detran-300 bg-detran-50' : 'border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="perfil"
                    className="mt-1"
                    checked={form.perfil === perfil.valor}
                    onChange={() => setForm({ ...form, perfil: perfil.valor })}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">{perfil.rotulo}</span>
                    <span className="block text-xs text-slate-500">{perfil.descricao}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="rotulo">Unidade</label>
              <select
                className="campo"
                value={form.unidadeId ?? ''}
                onChange={(e) =>
                  setForm({ ...form, unidadeId: e.target.value ? Number(e.target.value) : null, guicheId: null })
                }
              >
                <option value="">Sem unidade</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="rotulo">Guichê</label>
              <select
                className="campo"
                value={form.guicheId ?? ''}
                onChange={(e) => setForm({ ...form, guicheId: e.target.value ? Number(e.target.value) : null })}
                disabled={!form.unidadeId}
              >
                <option value="">Sem guichê</option>
                {guichesDaUnidade.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.identificacao}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!modal.edicao && (
            <div>
              <label className="rotulo">Senha provisória</label>
              <input
                className="campo"
                type="text"
                value={form.senha}
                onChange={(e) => setForm({ ...form, senha: e.target.value })}
                placeholder="Mínimo 10 caracteres, com maiúscula, minúscula e número"
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
            Usuário ativo
          </label>

          <button type="button" className="botao-primario w-full" onClick={() => void salvar()}>
            Salvar usuário
          </button>
        </div>
      </Modal>

      <Modal aberto={Boolean(modalSenha)} titulo={`Redefinir senha de ${modalSenha?.nome ?? ''}`} aoFechar={() => setModalSenha(null)}>
        <div className="space-y-3">
          <Alerta tipo="atencao">
            A senha definida aqui é provisória: o servidor deverá trocá-la no próximo acesso.
          </Alerta>
          <input
            className="campo"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            placeholder="Nova senha provisória"
          />
          <button type="button" className="botao-primario w-full" onClick={() => void redefinirSenha()}>
            Definir senha
          </button>
        </div>
      </Modal>
    </div>
  );
}
