<#
.SYNOPSIS
    opencode 中文模式切换脚本，供 /chinese 命令调用。

.DESCRIPTION
    读写 ~/.config/opencode/chinese-mode.json 状态文件，
    与 plugins/chinese-mode.ts 插件共享状态；插件每次 LLM
    请求前重新读取该文件，因此切换即时生效、无需重启。

.USAGE
    chinese-mode.ps1 [toggle|on|off|status|tools-on|tools-off|enhanced-on|enhanced-off]

    无参数        切换总开关（开 <-> 关）
    on / off      明确开启 / 关闭总开关
    status        仅显示当前状态（并确保状态文件存在）
    tools-on      开启工具区域中文注入（同时开启总开关）
    tools-off     关闭工具区域中文注入
    enhanced-on   开启思考防漂移强化段（中文引导语锚定 + 正反示例）
    enhanced-off  关闭思考防漂移强化段
#>

param(
    [Parameter(Position = 0)]
    [string]$Action = "toggle"
)

$ErrorActionPreference = "Stop"

# 强制 stdout 以 UTF-8 写出（必须在任何输出发生前设置，
# 否则 writer 已按系统 ANSI 代码页缓存，补设无效导致 TUI 中文乱码）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$path = Join-Path $HOME ".config\opencode\chinese-mode.json"

# ---- 读取现有状态（缺失或损坏时回退到默认值）----
$state = @{ enabled = $true; reply = $true; thinking = $true; tools = $false; enhanced = $true }
if (Test-Path -LiteralPath $path) {
    try {
        $loaded = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
        foreach ($key in @("enabled", "reply", "thinking", "tools", "enhanced")) {
            if ($loaded.ContainsKey($key) -and $null -ne $loaded[$key]) {
                $state[$key] = [bool]$loaded[$key]
            }
        }
    } catch {
        # 状态文件损坏：重置为默认值继续执行
    }
}

# ---- 解析动作 ----
$actionKey = $Action.Trim().ToLowerInvariant()
$known = @("toggle", "on", "off", "status", "tools-on", "tools-off", "enhanced-on", "enhanced-off")
if ($known -notcontains $actionKey) {
    Write-Output ("未知参数: {0}。用法: /chinese [on|off|status|tools-on|tools-off|enhanced-on|enhanced-off]，无参数时为切换开关。" -f $Action)
    return
}

switch ($actionKey) {
    "on"           { $state.enabled = $true }
    "off"          { $state.enabled = $false }
    "tools-on"     { $state.tools = $true; $state.enabled = $true }
    "tools-off"    { $state.tools = $false }
    "enhanced-on"  { $state.enhanced = $true; $state.enabled = $true }
    "enhanced-off" { $state.enhanced = $false }
    "status"       { }
    default        { $state.enabled = -not $state.enabled }  # toggle
}

# ---- 写回状态文件 ----
$dir = Split-Path -Parent $path
if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}
$state | ConvertTo-Json | Set-Content -LiteralPath $path -Encoding UTF8

# ---- 输出人类可读状态（该输出会嵌入 prompt 发给模型做确认）----
$mode = if ($state.enabled) { "已开启" } else { "已关闭" }
$areas = @()
if ($state.enabled) {
    $areas += if ($state.reply) { "回复=中文" } else { "回复=不注入" }
    $areas += if ($state.thinking) { "思考=中文" } else { "思考=不注入" }
    if ($state.thinking) {
        $areas += if ($state.enhanced) { "防漂移强化=开" } else { "防漂移强化=关" }
    }
    $areas += if ($state.tools) { "工具=中文" } else { "工具=默认" }
}
$status = "中文模式: $mode"
if ($areas.Count -gt 0) {
    $status += " (" + ($areas -join ", ") + ")"
}
Write-Output $status
