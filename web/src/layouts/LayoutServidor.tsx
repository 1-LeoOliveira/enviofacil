import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAutenticacao } from '../lib/autenticacao';
import type { ParametrosPublicos } from '../lib/tipos';
import { AvisoDemonstracao, Marca } from '../components/ui';

interface ItemMenu {
  para: string;
  rotulo: string;
  icone: JSX.Element;
  perfis?: Array<'ADMIN' | 'SUPERVISOR' | 'ATENDENTE'>;
}

function Icone({ caminho }: { caminho: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d={caminho} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const MENU: ItemMenu[] = [
  { para: '/app', rotulo: 'Painel', icone: <Icone caminho="M4 13h7V4H4v9Zm9 7h7v-9h-7v9ZM4 20h7v-5H4v5Zm9-11h7V4h-7v5Z" /> },
  { para: '/app/novo', rotulo: 'Novo atendimento', icone: <Icone caminho="M12 5v14M5 12h14" /> },
  { para: '/app/atendimentos', rotulo: 'Atendimentos', icone: <Icone caminho="M8 6h10M8 12h10M8 18h10M4 6h.01M4 12h.01M4 18h.01" /> },
  {
    para: '/admin/indicadores',
    rotulo: 'Indicadores',
    icone: <Icone caminho="M4 19h16M7 16V9m5 7V5m5 11v-5" />,
    perfis: ['ADMIN', 'SUPERVISOR'],
  },
  {
    para: '/admin/servicos',
    rotulo: 'Serviços e documentos',
    icone: <Icone caminho="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />,
    perfis: ['ADMIN', 'SUPERVISOR'],
  },
  {
    para: '/admin/unidades',
    rotulo: 'Unidades e guichês',
    icone: <Icone caminho="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />,
    perfis: ['ADMIN'],
  },
  {
    para: '/admin/usuarios',
    rotulo: 'Usuários',
    icone: <Icone caminho="M16 19v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
    perfis: ['ADMIN'],
  },
  {
    para: '/admin/configuracoes',
    rotulo: 'Configurações',
    icone: <Icone caminho="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2-1.2L14.6 3H9.4l-.4 2.5c-.7.3-1.4.7-2 1.2l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.4 2.5h5.2l.4-2.5c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />,
    perfis: ['ADMIN'],
  },
  {
    para: '/admin/auditoria',
    rotulo: 'Auditoria',
    icone: <Icone caminho="M9 12l2 2 4-4M12 3l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7l7-4Z" />,
    perfis: ['ADMIN'],
  },
];

export function LayoutServidor() {
  const { usuario, sair, loginDesabilitado, usuariosDemonstracao, trocarUsuario } = useAutenticacao();
  const navegar = useNavigate();
  const [menuAberto, setMenuAberto] = useState(false);
  const [parametros, setParametros] = useState<ParametrosPublicos | null>(null);

  useEffect(() => {
    api
      .get<ParametrosPublicos>('/publico/parametros', 'publico')
      .then(setParametros)
      .catch(() => setParametros(null));
  }, []);

  const itens = MENU.filter((item) => !item.perfis || (usuario && item.perfis.includes(usuario.perfil)));

  async function encerrar() {
    await sair();
    navegar('/entrar', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-30 bg-detran-800 text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-md p-1.5 hover:bg-white/10 lg:hidden"
              onClick={() => setMenuAberto((v) => !v)}
              aria-label="Abrir menu"
            >
              <Icone caminho="M4 6h16M4 12h16M4 18h16" />
            </button>
            <Link to="/app">
              <Marca invertida />
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight">{usuario?.nome}</p>
              <p className="text-[11px] text-detran-100">
                {usuario?.perfil === 'ATENDENTE' ? 'Atendente' : usuario?.perfil === 'SUPERVISOR' ? 'Supervisor' : 'Administrador'}
                {usuario?.unidade ? ` · ${usuario.unidade.sigla}` : ''}
                {usuario?.guiche ? ` · ${usuario.guiche.identificacao}` : ''}
              </p>
            </div>
            {loginDesabilitado ? (
              // Sem tela de login: troca de perfil direto no cabeçalho, para testar
              // as permissões de cada papel sem precisar de senha.
              <label className="flex items-center gap-2 rounded-lg bg-white/10 px-2.5 py-1.5">
                <span className="hidden text-[11px] font-semibold uppercase tracking-wide text-detran-100 sm:block">
                  Perfil
                </span>
                <select
                  className="rounded bg-transparent py-0.5 text-sm font-medium text-white outline-none [&>option]:text-slate-800"
                  value={usuario?.id ?? ''}
                  onChange={(e) => void trocarUsuario(Number(e.target.value))}
                  aria-label="Trocar o perfil de demonstração"
                >
                  {usuariosDemonstracao.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.perfil === 'ADMIN' ? 'Administrador' : u.perfil === 'SUPERVISOR' ? 'Supervisor' : 'Atendente'}
                      {u.unidadeSigla ? ` · ${u.unidadeSigla}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <button type="button" onClick={() => void encerrar()} className="rounded-lg bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/20">
                Sair
              </button>
            )}
          </div>
        </div>
      </header>

      {parametros?.ambiente.demonstracao && <AvisoDemonstracao />}

      {loginDesabilitado && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-1.5">
          <p className="mx-auto max-w-7xl text-[12px] font-semibold text-rose-800">
            Acesso sem autenticação ativado (LOGIN_DESABILITADO=true) — apenas para desenvolvimento.
            A tela de login e o controle de senha continuam no sistema e voltam ao desligar esta opção.
          </p>
        </div>
      )}

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <nav
          className={`${
            menuAberto ? 'block' : 'hidden'
          } fixed inset-x-0 top-[60px] z-20 border-b border-slate-200 bg-white p-3 shadow-lg lg:static lg:top-0 lg:block lg:w-64 lg:shrink-0 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none`}
        >
          <ul className="space-y-1">
            {itens.map((item) => (
              <li key={item.para}>
                <NavLink
                  to={item.para}
                  end={item.para === '/app'}
                  onClick={() => setMenuAberto(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-detran-700 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-white hover:text-detran-800'
                    }`
                  }
                >
                  {item.icone}
                  {item.rotulo}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
            <p className="font-semibold text-slate-700">Acesso pelo celular</p>
            <p className="mt-1">
              O cidadão pode entrar por <span className="font-mono">/acesso</span> digitando o código curto, caso a câmera não leia o QR Code.
            </p>
          </div>
        </nav>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
