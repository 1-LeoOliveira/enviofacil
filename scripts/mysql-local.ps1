<#
.SINOPSE
  MySQL 8 local para o Envio Fácil, sem Docker e sem virtualização.

  Usado enquanto o Docker Desktop não puder rodar nesta máquina (a engine Linux
  exige virtualização habilitada na BIOS). O banco fica em
  %LOCALAPPDATA%\EnvioFacil e não interfere em nenhuma instalação existente.

.EXEMPLOS
  powershell -ExecutionPolicy Bypass -File scripts\mysql-local.ps1 instalar
  powershell -ExecutionPolicy Bypass -File scripts\mysql-local.ps1 iniciar
  powershell -ExecutionPolicy Bypass -File scripts\mysql-local.ps1 status
  powershell -ExecutionPolicy Bypass -File scripts\mysql-local.ps1 parar
  powershell -ExecutionPolicy Bypass -File scripts\mysql-local.ps1 remover
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('instalar', 'iniciar', 'parar', 'status', 'remover', 'console')]
  [string]$Acao = 'status',

  [int]$Porta = 3307,
  [string]$Banco = 'envio_facil',
  [string]$Usuario = 'envio_facil',
  [string]$Senha = 'envio_facil'
)

$ErrorActionPreference = 'Stop'

$Raiz      = Join-Path $env:LOCALAPPDATA 'EnvioFacil'
$Versao    = 'mysql-8.4.3-winx64'
$Base      = Join-Path $Raiz $Versao
$Dados     = Join-Path $Raiz 'dados'
$Ini       = Join-Path $Raiz 'my.ini'
$LogErro   = Join-Path $Raiz 'mysql-erro.log'
$Zip       = Join-Path $Raiz "$Versao.zip"
$UrlMysql  = "https://dev.mysql.com/get/Downloads/MySQL-8.4/$Versao.zip"

function Escrever($texto, $cor = 'Gray') { Write-Host $texto -ForegroundColor $cor }

function Caminho-Mysqld { Join-Path $Base 'bin\mysqld.exe' }
function Caminho-Mysql { Join-Path $Base 'bin\mysql.exe' }

function Processo-Mysqld {
  Get-CimInstance Win32_Process -Filter "Name = 'mysqld.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$Ini*" }
}

function Esta-Rodando {
  try {
    $t = New-Object System.Net.Sockets.TcpClient
    $t.Connect('127.0.0.1', $Porta)
    $t.Close()
    return $true
  } catch { return $false }
}

function Aguardar-Banco([int]$segundos = 60) {
  for ($i = 0; $i -lt $segundos; $i++) {
    if (Esta-Rodando) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Baixar-Mysql {
  if (Test-Path (Caminho-Mysqld)) { return }
  if (-not (Test-Path $Raiz)) { New-Item -ItemType Directory -Path $Raiz -Force | Out-Null }
  if (-not (Test-Path $Zip)) {
    Escrever "Baixando MySQL 8.4 (~250 MB)..." 'Cyan'
    & curl.exe -sL --max-time 1800 -o $Zip $UrlMysql
    if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar o MySQL." }
  }
  Escrever "Extraindo..." 'Cyan'
  & "$env:SystemRoot\System32\tar.exe" -xf $Zip -C $Raiz
  if (-not (Test-Path (Caminho-Mysqld))) { throw "mysqld.exe não encontrado após a extração." }
}

function Escrever-Configuracao {
  $conteudo = @"
# Gerado por scripts/mysql-local.ps1 - Envio Fácil
[mysqld]
basedir=$($Base -replace '\\','/')
datadir=$($Dados -replace '\\','/')
port=$Porta
bind-address=127.0.0.1
mysqlx=0
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
default-time-zone='+00:00'
log-error=$($LogErro -replace '\\','/')
max_connections=64
innodb_buffer_pool_size=256M

[client]
port=$Porta
host=127.0.0.1
"@
  Set-Content -Path $Ini -Value $conteudo -Encoding ASCII
}

function Executar-Sql([string]$sql, [string]$usuarioSql = 'root', [string]$senhaSql = '') {
  $argumentos = @("--defaults-file=$Ini", "--protocol=TCP", "-h", "127.0.0.1", "-P", "$Porta", "-u", $usuarioSql)
  if ($senhaSql) { $argumentos += "-p$senhaSql" }
  $argumentos += @("-e", $sql)
  $saida = & (Caminho-Mysql) @argumentos 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Falha no SQL: $saida" }
  return $saida
}

switch ($Acao) {

  'instalar' {
    Baixar-Mysql
    if (Test-Path (Join-Path $Dados 'mysql')) {
      Escrever "Banco já inicializado em $Dados" 'Yellow'
    } else {
      Escrever-Configuracao
      Escrever "Inicializando o diretório de dados..." 'Cyan'
      & (Caminho-Mysqld) "--defaults-file=$Ini" --initialize-insecure --console
      if ($LASTEXITCODE -ne 0) { throw "Falha ao inicializar o MySQL. Veja $LogErro" }
    }

    Escrever-Configuracao
    if (-not (Esta-Rodando)) {
      Escrever "Subindo o servidor..." 'Cyan'
      Start-Process -FilePath (Caminho-Mysqld) -ArgumentList "--defaults-file=$Ini" -WindowStyle Hidden
      if (-not (Aguardar-Banco 90)) { throw "O MySQL não respondeu na porta $Porta. Veja $LogErro" }
    }

    Escrever "Criando banco e usuário da aplicação..." 'Cyan'
    $sql = @"
CREATE DATABASE IF NOT EXISTS ``$Banco`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$Usuario'@'127.0.0.1' IDENTIFIED BY '$Senha';
CREATE USER IF NOT EXISTS '$Usuario'@'localhost' IDENTIFIED BY '$Senha';
GRANT ALL PRIVILEGES ON ``$Banco``.* TO '$Usuario'@'127.0.0.1';
GRANT ALL PRIVILEGES ON ``$Banco``.* TO '$Usuario'@'localhost';
FLUSH PRIVILEGES;
"@
    Executar-Sql $sql | Out-Null
    Escrever ""
    Escrever "MySQL pronto em 127.0.0.1:$Porta" 'Green'
    Escrever "  banco:   $Banco"
    Escrever "  usuário: $Usuario / $Senha"
    Escrever "  dados:   $Dados"
  }

  'iniciar' {
    if (Esta-Rodando) { Escrever "Já está rodando na porta $Porta." 'Yellow'; break }
    if (-not (Test-Path (Caminho-Mysqld))) { throw "MySQL não instalado. Rode: mysql-local.ps1 instalar" }
    Start-Process -FilePath (Caminho-Mysqld) -ArgumentList "--defaults-file=$Ini" -WindowStyle Hidden
    if (Aguardar-Banco 90) { Escrever "MySQL no ar em 127.0.0.1:$Porta" 'Green' }
    else { throw "Não subiu. Veja $LogErro" }
  }

  'parar' {
    $processos = Processo-Mysqld
    if (-not $processos) { Escrever "Nenhum mysqld desta instância em execução." 'Yellow'; break }
    foreach ($p in $processos) { Stop-Process -Id $p.ProcessId -Force }
    Escrever "MySQL encerrado." 'Green'
  }

  'status' {
    $rodando = Esta-Rodando
    Escrever ("instalado : " + (Test-Path (Caminho-Mysqld)))
    Escrever ("dados     : " + (Test-Path (Join-Path $Dados 'mysql')))
    Escrever ("porta $Porta : " + $(if ($rodando) { "respondendo" } else { "sem resposta" })) $(if ($rodando) { 'Green' } else { 'Yellow' })
    if (Test-Path $LogErro) { Escrever "log       : $LogErro" }
  }

  'console' {
    & (Caminho-Mysql) "--defaults-file=$Ini" --protocol=TCP -h 127.0.0.1 -P $Porta -u $Usuario "-p$Senha" $Banco
  }

  'remover' {
    $processos = Processo-Mysqld
    foreach ($p in $processos) { Stop-Process -Id $p.ProcessId -Force }
    if (Test-Path $Dados) { Remove-Item -Recurse -Force $Dados }
    Escrever "Dados removidos. O binário segue em $Base (apague a pasta para remover tudo)." 'Green'
  }
}
