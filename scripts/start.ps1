[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$Port = 3080,
    [string]$RuntimeDirectory = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$homePath = Join-Path $projectRoot '.dsh-home'
$savedRuntime = Join-Path $homePath 'dashboard-runtime.json'
$runtimePath = if ($RuntimeDirectory) {
    [IO.Path]::GetFullPath($RuntimeDirectory)
} elseif (Test-Path -LiteralPath $savedRuntime) {
    (Get-Content -LiteralPath $savedRuntime -Raw | ConvertFrom-Json).runtimeDirectory
} else {
    Join-Path $projectRoot '.runtime'
}
$dshEntry = Join-Path $runtimePath 'node_modules\@deepseek-ai\dsh\lib\bin.js'
if (-not (Test-Path -LiteralPath $dshEntry)) {
    throw 'Local Harness is not installed. Run .\scripts\setup.ps1 first.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'client.js'))) {
    throw 'The plugin has not been built. Run .\scripts\setup.ps1 first.'
}
$recordedNode = if (Test-Path -LiteralPath $savedRuntime) {
    (Get-Content -LiteralPath $savedRuntime -Raw | ConvertFrom-Json).nodeExecutable
}
$availableNode = Get-Command node -ErrorAction SilentlyContinue
$nodeCommand = if ($recordedNode -and (Test-Path -LiteralPath $recordedNode)) {
    $recordedNode
} elseif ($availableNode) { $availableNode.Source }
if (-not $nodeCommand -or -not (Test-Path -LiteralPath $nodeCommand)) {
    throw 'Node.js is not available. Run scripts/setup.ps1 again to record the local runtime.'
}
$nodeMajor = [int]((& $nodeCommand -p 'process.versions.node.split(".")[0]').Trim())
if ($nodeMajor -lt 24) { throw 'This proof of concept requires Node.js 24 or later. Run setup.ps1 with a supported Node.js.' }
$environmentNames = @('DSH_HOME', 'DSH_AGENTS_HOME', 'DSH_BUNDLED_SKILL_DIR', 'DSH_TELEMETRY_MODE')
$previous = @{}
foreach ($name in $environmentNames) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

Push-Location -LiteralPath $projectRoot
try {
    $env:DSH_HOME = $homePath
    $env:DSH_AGENTS_HOME = Join-Path $homePath 'agents'
    $env:DSH_BUNDLED_SKILL_DIR = Join-Path $homePath 'bundled-skills'
    $env:DSH_TELEMETRY_MODE = 'DISABLED'
    Write-Host "Opening the local server at http://127.0.0.1:$Port . Press Ctrl+C to stop."
    # This boots the supported Web profile. It does not submit an agent prompt.
    & $nodeCommand $dshEntry web --patch (Join-Path $PSScriptRoot 'runtime.patch.yml') --host 127.0.0.1 --port $Port --no-open
    if ($LASTEXITCODE -notin @(0, 130)) { throw "Harness exited with code $LASTEXITCODE." }
} finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    Pop-Location
}
