[CmdletBinding()]
param(
    [string]$RuntimeDirectory = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimePath = if ($RuntimeDirectory) {
    [IO.Path]::GetFullPath($RuntimeDirectory)
} else {
    Join-Path $projectRoot '.runtime'
}
$homePath = Join-Path $projectRoot '.dsh-home'
$pnpmCommand = (Get-Command pnpm -ErrorAction Stop).Source
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$nodeMajor = [int]((& $nodeCommand -p 'process.versions.node.split(".")[0]').Trim())
if ($nodeMajor -lt 24) { throw 'This proof of concept requires Node.js 24 or later.' }

function Invoke-Pnpm {
    param([string[]]$Arguments)
    & $pnpmCommand @Arguments
    if ($LASTEXITCODE -ne 0) { throw "pnpm failed (exit $LASTEXITCODE): $($Arguments -join ' ')" }
}

Push-Location -LiteralPath $projectRoot
try {
    Invoke-Pnpm -Arguments @('install', '--frozen-lockfile', '--ignore-scripts')
    Invoke-Pnpm -Arguments @('run', 'typecheck')
    Invoke-Pnpm -Arguments @('run', 'build')
    Invoke-Pnpm -Arguments @('run', 'test')
} finally { Pop-Location }

New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$runtimeManifest = Join-Path $runtimePath 'package.json'
if (Test-Path -LiteralPath $runtimeManifest) {
    $existing = Get-Content -LiteralPath $runtimeManifest -Raw | ConvertFrom-Json
    if ($existing.dependencies.'@deepseek-ai/dsh' -ne '0.2.1-rc.2') {
        throw "The runtime directory does not pin @deepseek-ai/dsh 0.2.1-rc.2: $runtimePath"
    }
} else {
    @{
        name = 'dashboard-local-harness-runtime'
        private = $true
        type = 'module'
        dependencies = @{ '@deepseek-ai/dsh' = '0.2.1-rc.2' }
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $runtimeManifest -Encoding utf8
}

# Keep optional Office engines out of this chat-only development runtime.
# Do not replace any configuration that already exists in an explicitly supplied runtime.
$runtimeSettings = Join-Path $runtimePath 'pnpm-workspace.yaml'
if (-not (Test-Path -LiteralPath $runtimeSettings)) {
    "ignoredOptionalDependencies:`n  - '@deepseek-ai/libreoffice-kit-*'`n" |
        Set-Content -LiteralPath $runtimeSettings -Encoding utf8
}

$previousDshHome = $env:DSH_HOME
Push-Location -LiteralPath $runtimePath
try {
    if (-not (Test-Path -LiteralPath (Join-Path $runtimePath 'pnpm-lock.yaml'))) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime-lock.yaml') -Destination (Join-Path $runtimePath 'pnpm-lock.yaml')
    }
    Invoke-Pnpm -Arguments @('install', '--frozen-lockfile', '--ignore-scripts')
    $env:DSH_HOME = $homePath
    # The official forwarder anchors path specs and records dsh.bundle.patch.
    # A link keeps the built client.js available without installing developer dependencies into the profile.
    Invoke-Pnpm -Arguments @('exec', 'dsh', 'plugin', '--profile', 'web', 'add', "link:$projectRoot", '--ignore-scripts')
    New-Item -ItemType Directory -Path $homePath -Force | Out-Null
    @{ runtimeDirectory = $runtimePath; nodeExecutable = $nodeCommand } | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $homePath 'dashboard-runtime.json') -Encoding utf8
} finally {
    $env:DSH_HOME = $previousDshHome
    Pop-Location
}

Write-Host 'Plugin checks and local installation completed.'
Write-Host 'Start the UI with: .\scripts\start.ps1'
Write-Host 'The chat-only runtime omits optional Office conversion engines.'
