param(
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$Builder = Join-Path $PSScriptRoot "build_admin.py"
$Arguments = @($Builder)
if ($SkipTests) {
    $Arguments += "--skip-tests"
}
python @Arguments
exit $LASTEXITCODE

