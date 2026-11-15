<#
.SINOPSE
  Sobe a API e o front-end do Envio Fácil em segundo plano, sem Docker.

  Os processos ficam independentes do terminal que os iniciou, com log em
  arquivo. Para o banco, use scripts/mysql-local.ps1.

.EXEMPLOS
  powershell -ExecutionPolicy Bypass -File scripts\app-local.ps1 iniciar
  powershell -ExecutionPolicy Bypass -File scripts\app-local.ps1 status
  powershell -ExecutionPolicy Bypass -File scripts\app-local.ps1 logs
  powershell -ExecutionPolicy Bypass -File scripts\app-local.ps1 parar
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('iniciar', 'parar', 'status', 'logs', 'reiniciar', 'rede', 'local')]
  [string]$Acao = 'status',

  [int]$PortaApi = 4000,
  [int]$PortaWeb = 5173
)

$ErrorActionPreference = 'Stop'

$Raiz    = Split-Path -Parent $PSScriptRoot
$DirApi  = Join-Path $Raiz 'api'
$DirWeb  = Join-Path $Raiz 'web'
$DirLogs = Join-Path $Raiz '.logs'
$LogApi  = Join-Path $DirLogs 'api.log'
$LogWeb  = Join-Path $DirLogs 'web.log'

function Escrever($texto, $cor = 'Gray') { Write-Host $texto -ForegroundColor $cor }

function Porta-Ocupada([int]$porta) {
  [bool](Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue)
}

function Processo-Da-Porta([int]$porta) {
  $con = Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($con) { Get-Process -Id $con.OwningProcess -ErrorAction SilentlyContinue }
}

function Aguardar-Porta([int]$porta, [int]$segundos = 60) {
  for ($i = 0; $i -lt $segundos; $i++) {
    if (Porta-Ocupada $porta) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Subir([string]$nome, [string]$diretorio, [string]$comando, [string]$log, [int]$porta) {
  if (Porta-Ocupada $porta) {
    Escrever "$nome já está na porta $porta." 'Yellow'
    return
  }
  if (-not (Test-Path (Join-Path $diretorio 'node_modules'))) {
    throw "Dependências de $nome não instaladas. Rode: npm run instalar"
  }
  # cmd /c mantém o processo vivo após este script terminar.
  Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', "$comando > `"$log`" 2>&1" `
    -WorkingDirectory $diretorio `
    -WindowStyle Hidden
  if (Aguardar-Porta $porta 90) { Escrever "$nome no ar (porta $porta)" 'Green' }
  else { throw "$nome não subiu. Veja $log" }
}

function Ip-Da-Rede {
  # A placa com gateway padrão é a que o celular alcança. Interfaces virtuais
  # (WSL, Hyper-V, VirtualBox) não servem: o celular não enxerga essas redes.
  $config = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' -and $_.InterfaceAlias -notmatch 'WSL|vEthernet|Loopback|VirtualBox' } |
    Select-Object -First 1
  if (-not $config) { throw "Nenhuma interface de rede com gateway encontrada." }
  return $config.IPv4Address.IPAddress
}

function Definir-UrlPublica([string]$url, [string]$origens) {
  $arquivo = Join-Path $DirApi '.env'
  if (-not (Test-Path $arquivo)) { throw "api\.env não encontrado." }
  $conteudo = Get-Content $arquivo -Raw
  $conteudo = [regex]::Replace($conteudo, '(?m)^APP_PUBLIC_URL=.*$', "APP_PUBLIC_URL=$url")
  $conteudo = [regex]::Replace($conteudo, '(?m)^CORS_ORIGINS=.*$', "CORS_ORIGINS=$origens")
  Set-Content -Path $arquivo -Value $conteudo.TrimEnd() -Encoding UTF8
}

function Reiniciar-Api {
  $proc = Processo-Da-Porta $PortaApi
  if ($proc) { Stop-Process -Id $proc.Id -Force; Start-Sleep -Milliseconds 800 }
  Subir 'API' $DirApi "npx tsx src/server.ts" $LogApi $PortaApi
}

switch ($Acao) {

  'rede' {
    $ip = Ip-Da-Rede
    $url = "http://${ip}:$PortaWeb"
    Definir-UrlPublica $url "$url,http://localhost:$PortaWeb,http://localhost:8080"
    Reiniciar-Api
    Escrever ""
    Escrever "QR Code agora aponta para $url" 'Green'
    Escrever "Conecte o celular na mesma rede e leia o QR gerado em um novo atendimento."

    $regra = Get-NetFirewallRule -Direction Inbound -Enabled True -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -match 'Node\.js' }
    if (-not $regra) {
      Escrever ""
      Escrever "Se o celular não abrir a página, libere a porta no firewall (como administrador):" 'Yellow'
      Escrever "  netsh advfirewall firewall add rule name=`"Envio Facil $PortaWeb`" dir=in action=allow protocol=TCP localport=$PortaWeb"
    }
  }

  'local' {
    $url = "http://localhost:$PortaWeb"
    Definir-UrlPublica $url "$url,http://localhost:8080"
    Reiniciar-Api
    Escrever "QR Code voltou a apontar para $url" 'Green'
  }

  'iniciar' {
    if (-not (Test-Path $DirLogs)) { New-Item -ItemType Directory -Path $DirLogs -Force | Out-Null }

    # O banco precisa estar no ar antes da API.
    $mysql = Join-Path $PSScriptRoot 'mysql-local.ps1'
    if (-not (Porta-Ocupada 3307)) {
      Escrever "Subindo o MySQL local..." 'Cyan'
      & powershell -ExecutionPolicy Bypass -File $mysql iniciar | Out-Null
    }

    Subir 'API'       $DirApi "npx tsx src/server.ts"                              $LogApi $PortaApi
    Subir 'Front-end' $DirWeb "npx vite --port $PortaWeb --strictPort --host"      $LogWeb $PortaWeb

    Escrever ""
    Escrever "Aplicação:  http://localhost:$PortaWeb" 'Green'
    Escrever "API:        http://localhost:$PortaApi/api"
    Escrever "Logs:       $DirLogs"
  }

  'parar' {
    foreach ($porta in @($PortaWeb, $PortaApi)) {
      $proc = Processo-Da-Porta $porta
      if ($proc) {
        Stop-Process -Id $proc.Id -Force
        Escrever "porta $porta encerrada ($($proc.Name))" 'Green'
      } else {
        Escrever "porta $porta já estava livre" 'Yellow'
      }
    }
    Escrever "O MySQL segue no ar. Para encerrar: scripts\mysql-local.ps1 parar"
  }

  'reiniciar' {
    & $PSCommandPath parar
    & $PSCommandPath iniciar
  }

  'status' {
    foreach ($item in @(@{n='MySQL'; p=3307}, @{n='API'; p=$PortaApi}, @{n='Front-end'; p=$PortaWeb})) {
      $proc = Processo-Da-Porta $item.p
      if ($proc) { Escrever ("{0,-10} porta {1} : no ar ({2})" -f $item.n, $item.p, $proc.Name) 'Green' }
      else { Escrever ("{0,-10} porta {1} : parado" -f $item.n, $item.p) 'Yellow' }
    }
  }

  'logs' {
    if (Test-Path $LogApi) { Escrever "--- api.log (últimas 20) ---" 'Cyan'; Get-Content $LogApi -Tail 20 }
    if (Test-Path $LogWeb) { Escrever "--- web.log (últimas 20) ---" 'Cyan'; Get-Content $LogWeb -Tail 20 }
  }
}
