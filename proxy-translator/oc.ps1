# OpenCode 中文翻译代理 — 一键启动命令
# 运行方式：在任意 PowerShell 中输入 oc 即可
#
# 首次使用前先运行一次 setup.ps1 完成注册：
#   PowerShell -ExecutionPolicy Bypass -File setup.ps1

$Host.UI.RawUI.WindowTitle = "OpenCode 中文翻译代理"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OpenCode 中文翻译代理 — 一键启动" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 脚本所在目录
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir
Write-Host "[INFO] 项目目录: $ProjectDir" -ForegroundColor DarkGray
Write-Host ""

# =============================================
# 1. 检查依赖
# =============================================
Write-Host "[1/4] 检查依赖..." -ForegroundColor Yellow

try {
    $nodeVer = node --version
} catch {
    Write-Host "  ✗ Node.js 未安装！请先安装 Node.js >= 18" -ForegroundColor Red
    pause; exit 1
}

try {
    $ocVer = opencode --version
} catch {
    Write-Host "  ✗ opencode 命令未找到！请先安装 OpenCode" -ForegroundColor Red
    pause; exit 1
}

Write-Host "  ✓ Node.js $nodeVer" -ForegroundColor Green
Write-Host "  ✓ OpenCode $ocVer" -ForegroundColor Green
Write-Host ""

# =============================================
# 2. 检查端口
# =============================================
$proxyPort = 8081
$serverPort = 4096

function Test-PortInUse($port) {
    return [bool](netstat -ano | Select-String "LISTENING" | Select-String ":$port ")
}

$serverRunning = Test-PortInUse $serverPort
$proxyRunning  = Test-PortInUse $proxyPort

# =============================================
# 3. 启动 OpenCode Server
# =============================================
Write-Host "[2/4] 启动 OpenCode Server → http://localhost:$serverPort ..." -ForegroundColor Yellow

if (-not $serverRunning) {
    Start-Process powershell -WindowStyle Minimized -ArgumentList @(
        "-NoExit", "-Command", "& { opencode serve --port $serverPort }"
    )
    Write-Host "  ✓ 已启动（已最小化）" -ForegroundColor Green
} else {
    Write-Host "  ✓ 已在运行" -ForegroundColor Green
}

# =============================================
# 4. 启动翻译代理
# =============================================
Write-Host "[3/4] 启动翻译代理 → http://localhost:$proxyPort ..." -ForegroundColor Yellow

if (-not $proxyRunning) {
    Start-Process powershell -WindowStyle Minimized -ArgumentList @(
        "-NoExit", "-Command", "cd '$ProjectDir'; npm run dev"
    )
    Write-Host "  ✓ 已启动（已最小化）" -ForegroundColor Green
} else {
    Write-Host "  ✓ 已在运行" -ForegroundColor Green
}
Write-Host ""

# =============================================
# 等待代理就绪
# =============================================
Write-Host "  ⏳ 等待翻译代理就绪..." -ForegroundColor DarkGray

$ready = $false
for ($i = 1; $i -le 15; $i++) {
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:$proxyPort/global/health" -TimeoutSec 2 -UseBasicParsing
        Write-Host "  ✓ 代理就绪！（用时 ${i}s）" -ForegroundColor Green
        $ready = $true
        break
    } catch {
        if ($i -eq 15) {
            Write-Host "  ⚠ 代理未在 15 秒内就绪" -ForegroundColor Yellow
            Write-Host "  请检查翻译代理窗口（任务栏中）是否有错误信息" -ForegroundColor Yellow
        } else {
            Start-Sleep -Seconds 1
        }
    }
}
Write-Host ""

# =============================================
# 5. 打开 TUI
# =============================================
Write-Host "[4/4] 连接 OpenCode TUI ..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  正在启动 TUI..." -ForegroundColor Cyan
Write-Host "  关闭 TUI 即退出，后台窗口仍最小化保留" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

try {
    opencode attach http://localhost:$proxyPort
} catch {
    Write-Host "`n[ERROR] 连接失败" -ForegroundColor Red
    Write-Host "请检查：" -ForegroundColor Yellow
    Write-Host "  1. 任务栏中 OpenCode Server 窗口是否正常" -ForegroundColor Yellow
    Write-Host "  2. 任务栏中翻译代理窗口是否正常" -ForegroundColor Yellow
    Write-Host "  3. 关闭所有窗口后重新输入 oc" -ForegroundColor Yellow
}

Write-Host "`n[DONE] TUI 已退出。" -ForegroundColor Cyan
Write-Host "下次再输入 oc 即可重新连接。" -ForegroundColor DarkGray