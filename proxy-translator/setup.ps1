# OpenCode 便捷命令 — 一次性设置脚本
# 运行后，在任何 PowerShell 中输入 oc 即可一键启动
#
# 运行方式：
#   PowerShell -ExecutionPolicy Bypass -File setup.ps1

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProfilePath = $PROFILE.CurrentUserAllHosts

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OpenCode 便捷命令 — 安装" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查目标脚本
$OcScript = Join-Path $ProjectDir "oc.ps1"
if (-not (Test-Path $OcScript)) {
    Write-Host "[ERROR] 找不到 oc.ps1，请确保与 setup.ps1 在同一目录" -ForegroundColor Red
    pause; exit 1
}

Write-Host "项目目录: $ProjectDir" -ForegroundColor Gray
Write-Host "配置文件: $ProfilePath" -ForegroundColor Gray
Write-Host ""

# =============================================
# 检查是否已安装
# =============================================
$alreadyInstalled = $false
if (Test-Path $ProfilePath) {
    $content = Get-Content $ProfilePath -Raw -ErrorAction SilentlyContinue
    if ($content -match "function oc\s*\{") {
        $alreadyInstalled = $true
    }
}

if ($alreadyInstalled) {
    Write-Host "  ✓ oc 命令已安装，无需重复设置" -ForegroundColor Green
    Write-Host ""
    Write-Host "现在就可以在任何 PowerShell 中输入 oc 来一键启动。" -ForegroundColor Cyan
    Write-Host "如果 oc 不生效，请重启 PowerShell 或执行：. `$PROFILE" -ForegroundColor Gray
    pause; exit 0
}

# =============================================
# 备份当前 Profile
# =============================================
if (Test-Path $ProfilePath) {
    $backup = "$ProfilePath.setup-backup.ps1"
    Copy-Item $ProfilePath $backup -Force
    Write-Host "  ✓ 已备份原配置文件 → $backup" -ForegroundColor Green
}

# =============================================
# 写入函数定义
# =============================================
$functionDef = @"

# ===== OpenCode 一键启动 (oc) =====
# 由 setup.ps1 自动添加
function oc {
    & "$( $OcScript -replace "'", "''" )"
}

"@

# 确保 Profile 目录存在
$profileDir = Split-Path $ProfilePath -Parent
if (-not (Test-Path $profileDir)) {
    New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

Add-Content $ProfilePath $functionDef -Encoding UTF8

Write-Host "  ✓ oc 函数已写入配置文件" -ForegroundColor Green
Write-Host ""

# =============================================
# 完成
# =============================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  安装完成！" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "现在请在 PowerShell 中执行以下命令让 oc 生效：" -ForegroundColor Yellow

if ($alreadyInstalled) {
    Write-Host "  重启 PowerShell" -ForegroundColor White
} else {
    Write-Host "  . `$PROFILE" -ForegroundColor White
    Write-Host ""
    Write-Host "之后在任何 PowerShell 中输入 oc 即可一键启动。" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "如需卸载，编辑配置文件删除对应函数即可：" -ForegroundColor Gray
    Write-Host "  notepad `$PROFILE" -ForegroundColor Gray
}

Write-Host ""
pause