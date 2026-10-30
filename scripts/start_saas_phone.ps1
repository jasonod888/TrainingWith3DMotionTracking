param(
    [Parameter(Mandatory=$true)][string]$Address,
    [Parameter(Mandatory=$true)][string]$CertificatePath,
    [Parameter(Mandatory=$true)][string]$PrivateKeyPath,
    [ValidateRange(1024,65535)][int]$Port = 8444
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$formPhoneAddress = [System.Net.IPAddress]::Parse($Address)
$formPhoneBytes = $formPhoneAddress.GetAddressBytes()
if ($formPhoneBytes.Length -ne 4 -or -not ($formPhoneBytes[0] -eq 10 -or ($formPhoneBytes[0] -eq 172 -and $formPhoneBytes[1] -ge 16 -and $formPhoneBytes[1] -le 31) -or ($formPhoneBytes[0] -eq 192 -and $formPhoneBytes[1] -eq 168))) {
    throw 'Choose this computer''s private Wi-Fi IPv4 address.'
}
$formPhoneCertificate = (Resolve-Path -LiteralPath $CertificatePath).Path
$formPhoneKey = (Resolve-Path -LiteralPath $PrivateKeyPath).Path
if (-not (Test-Path -LiteralPath 'apps/web/dist/index.html')) { throw 'Build apps/web first.' }
$formPreviousPublicUrl = $env:PUBLIC_URL
try {
    $env:PUBLIC_URL = 'https://' + $Address + ':' + $Port
    Write-Output ('Phone test address: ' + $env:PUBLIC_URL)
    Write-Output 'Use a certificate trusted by both phones and valid for this address. This launcher does not install certificates or alter firewall settings.'
    & .venv-saas/Scripts/python.exe -m uvicorn apps.api.main:app --host $Address --port $Port --ssl-certfile $formPhoneCertificate --ssl-keyfile $formPhoneKey
    if ($LASTEXITCODE) { throw 'The phone test server stopped with an error.' }
} finally {
    if ($null -eq $formPreviousPublicUrl) { Remove-Item Env:PUBLIC_URL -ErrorAction SilentlyContinue } else { $env:PUBLIC_URL = $formPreviousPublicUrl }
}
