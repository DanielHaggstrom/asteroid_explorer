[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$HostAlias,
    [switch]$AsRoot
)

$ErrorActionPreference = 'Stop'
$deployExitCode = 1
$launcherArguments = @()

try {
    $pythonLauncher = Get-Command py.exe -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($pythonLauncher) {
        $pythonExecutable = $pythonLauncher.Path
        $launcherArguments = @('-3')
    }
    else {
        $realPython = Get-Command python.exe, python3.exe -CommandType Application -All -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -notmatch '[\\/]Microsoft[\\/]WindowsApps[\\/]' } |
            Select-Object -First 1
        if ($realPython) {
            $pythonExecutable = $realPython.Path
        }
        else {
            $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
            if (-not (Test-Path -LiteralPath $bundledPython -PathType Leaf)) {
                throw 'Python 3 was not found. Install Python or run deploy/publish.py with an existing Python 3 runtime.'
            }
            $pythonExecutable = $bundledPython
        }
    }

    Push-Location -LiteralPath $PSScriptRoot
    try {
        $publishArguments = $launcherArguments + @(
            (Join-Path $PSScriptRoot 'deploy\publish.py'), '--host', $HostAlias
        )
        if ($AsRoot) {
            $publishArguments += '--as-root'
        }
        & $pythonExecutable @publishArguments
        $deployExitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
catch {
    [Console]::Error.WriteLine("Deployment failed: $($_.Exception.Message)")
}

exit $deployExitCode
