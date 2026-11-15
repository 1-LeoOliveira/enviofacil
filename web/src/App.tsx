import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProvedorAutenticacao, RotaProtegida, useAutenticacao } from './lib/autenticacao';
import { LayoutServidor } from './layouts/LayoutServidor';
import { Entrar } from './pages/Entrar';
import { Painel } from './pages/atendente/Painel';
import { NovoAtendimento } from './pages/atendente/NovoAtendimento';
import { Atendimentos } from './pages/atendente/Atendimentos';
import { PainelRecebimento } from './pages/atendente/PainelRecebimento';
import { PortalCidadao } from './pages/portal/PortalCidadao';
import { AcessoPorCodigo } from './pages/portal/AcessoPorCodigo';
import { Servicos } from './pages/admin/Servicos';
import { UnidadesGuiches } from './pages/admin/UnidadesGuiches';
import { Usuarios } from './pages/admin/Usuarios';
import { Configuracoes } from './pages/admin/Configuracoes';
import { Indicadores } from './pages/admin/Indicadores';
import { Auditoria } from './pages/admin/Auditoria';
import { Marca } from './components/ui';

function NaoEncontrada() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 p-6 text-center">
      <Marca />
      <h1 className="text-2xl font-bold text-detran-900">Página não encontrada</h1>
      <p className="max-w-md text-slate-600">
        O endereço acessado não existe ou o acesso expirou. Se você é cidadão, leia novamente o QR Code ou
        informe o código de acesso recebido no guichê.
      </p>
      <div className="flex gap-2">
        <a href="/acesso" className="botao-primario">
          Código de acesso
        </a>
        <a href="/entrar" className="botao-neutro">
          Área do servidor
        </a>
      </div>
    </div>
  );
}

/** Com o login desabilitado não existe tela de entrada: vai direto para o painel. */
function RotaEntrada() {
  const { loginDesabilitado, carregando } = useAutenticacao();
  if (carregando) return null;
  return loginDesabilitado ? <Navigate to="/app" replace /> : <Entrar />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ProvedorAutenticacao>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/entrar" element={<RotaEntrada />} />

          {/* Portal do cidadão: sem conta, acesso por QR Code ou código curto */}
          <Route path="/s/:token" element={<PortalCidadao />} />
          <Route path="/portal" element={<PortalCidadao />} />
          <Route path="/acesso" element={<AcessoPorCodigo />} />

          {/* Área do servidor */}
          <Route
            path="/app"
            element={
              <RotaProtegida>
                <LayoutServidor />
              </RotaProtegida>
            }
          >
            <Route index element={<Painel />} />
            <Route path="novo" element={<NovoAtendimento />} />
            <Route path="atendimentos" element={<Atendimentos />} />
            <Route path="atendimentos/:id" element={<PainelRecebimento />} />
          </Route>

          {/* Painel administrativo */}
          <Route
            path="/admin"
            element={
              <RotaProtegida perfis={['ADMIN', 'SUPERVISOR']}>
                <LayoutServidor />
              </RotaProtegida>
            }
          >
            <Route index element={<Navigate to="/admin/indicadores" replace />} />
            <Route path="indicadores" element={<Indicadores />} />
            <Route path="servicos" element={<Servicos />} />
            <Route
              path="unidades"
              element={
                <RotaProtegida perfis={['ADMIN']}>
                  <UnidadesGuiches />
                </RotaProtegida>
              }
            />
            <Route
              path="usuarios"
              element={
                <RotaProtegida perfis={['ADMIN']}>
                  <Usuarios />
                </RotaProtegida>
              }
            />
            <Route
              path="configuracoes"
              element={
                <RotaProtegida perfis={['ADMIN']}>
                  <Configuracoes />
                </RotaProtegida>
              }
            />
            <Route
              path="auditoria"
              element={
                <RotaProtegida perfis={['ADMIN']}>
                  <Auditoria />
                </RotaProtegida>
              }
            />
          </Route>

          <Route path="*" element={<NaoEncontrada />} />
        </Routes>
      </ProvedorAutenticacao>
    </BrowserRouter>
  );
}
