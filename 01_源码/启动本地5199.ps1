param([switch]$Elevated)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$port = 5199
$url = "http://127.0.0.1:$port/"

function Test-Listen {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $task = $client.ConnectAsync('127.0.0.1', $port)
    $ok = $task.Wait(250) -and $client.Connected
    $client.Dispose()
    return $ok
  } catch { return $false }
}

function Test-CanBind {
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    $listener.Start()
    return $true
  } catch { return $false } finally {
    if ($listener) { try { $listener.Stop() } catch {} }
  }
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (Test-Listen) {
  Write-Host "✅ 本地服务已在运行：$url" -ForegroundColor Green
  exit 0
}

if (-not (Test-CanBind)) {
  if (-not $Elevated -and -not (Test-Admin)) {
    Write-Host 'Windows 保留了 5199 端口，正在请求一次管理员权限修复…' -ForegroundColor Yellow
    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated')
    $p = Start-Process -FilePath 'pwsh.exe' -Verb RunAs -ArgumentList $args -Wait -PassThru
    if ($p.ExitCode -ne 0 -or -not (Test-CanBind)) {
      Write-Host '❌ 5199 端口修复失败。请右键此脚本，选择“以管理员身份运行”。' -ForegroundColor Red
      exit 1
    }
  } elseif (Test-Admin) {
    Write-Host '正在释放被 Windows 保留的 5175-5274 端口段…' -ForegroundColor Yellow
    $winnatWasRunning = $false
    try {
      $winnat = Get-Service -Name winnat -ErrorAction SilentlyContinue
      if ($winnat -and $winnat.Status -eq 'Running') {
        Stop-Service -Name winnat -Force
        $winnatWasRunning = $true
      }
    } catch {}
    try {
      & netsh.exe int ipv4 delete excludedportrange protocol=tcp startport=5175 numberofports=100 | Out-Host
    } finally {
      if ($winnatWasRunning) { try { Start-Service -Name winnat } catch {} }
    }
    if (-not (Test-CanBind)) {
      Write-Host '❌ 端口仍被系统保留。请重启 Windows 后再运行一次本脚本。' -ForegroundColor Red
      exit 1
    }
    exit 0
  } else {
    Write-Host '❌ 5199 被系统保留且当前无法提权。请右键脚本并“以管理员身份运行”。' -ForegroundColor Red
    exit 1
  }
}

$node = (Get-Command node.exe).Source
$vite = Join-Path $here 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $vite)) {
  Write-Host '❌ 未找到 Vite，请先在 01_源码 执行 npm install。' -ForegroundColor Red
  exit 1
}

$outLog = Join-Path $env:TEMP 'xingce-vite-5199.out.log'
$errLog = Join-Path $env:TEMP 'xingce-vite-5199.err.log'
Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList @($vite, '--host', '127.0.0.1', '--port', '5199', '--strictPort') -WorkingDirectory $here -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 300
  if (Test-Listen) {
    Write-Host "✅ 已固定启动：$url" -ForegroundColor Green
    exit 0
  }
}

Write-Host '❌ 5199 启动失败，错误日志：' -ForegroundColor Red
Get-Content -LiteralPath $errLog -ErrorAction SilentlyContinue | Select-Object -Last 20
exit 1
