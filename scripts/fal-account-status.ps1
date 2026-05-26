param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

function Join-ApiUrl {
  param([string]$Base, [string]$Path)
  return ($Base.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Print-FalStatus {
  param($Status)

  Write-Host "fal key present: $($Status.falKeyPresent)"
  Write-Host "fal key source: $($Status.falKeySource)"
  Write-Host "auth ok: $($Status.authOk)"
  if ($Status.workspaceRedacted) { Write-Host "workspace/account: $($Status.workspaceRedacted)" }
  if ($Status.userRedacted) { Write-Host "user: $($Status.userRedacted)" }
  Write-Host "balance present: $($Status.balancePresent)"
  if ($null -ne $Status.balanceAmount) {
    $currency = $Status.balanceCurrency
    if (-not $currency) { $currency = "" }
    Write-Host "balance: $($Status.balanceAmount) $currency"
  }
  Write-Host "locked: $($Status.locked)"
  Write-Host "billing required: $($Status.billingRequired)"
  Write-Host "error category: $($Status.errorCategory)"
  if ($Status.errorSummary) { Write-Host "error summary: $($Status.errorSummary)" }
  if ($Status.recommendedNextAction) { Write-Host "recommended next action: $($Status.recommendedNextAction)" }
}

$path = "/api/diagnostics/fal-account-status"
$url = Join-ApiUrl $ApiBaseUrl $path

Write-Host "Checking fal account status from server environment..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Route: $path"
Write-Host "No fal key is read from this PowerShell session or printed."

try {
  $result = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec $TimeoutSeconds
} catch {
  $statusCode = $null
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
    $statusCode = [int]$_.Exception.Response.StatusCode
  }
  Write-Host "Request failed."
  if ($statusCode) { Write-Host "status code: $statusCode" }
  $rawBody = $_.ErrorDetails.Message
  if (-not [string]::IsNullOrWhiteSpace($rawBody)) {
    try {
      $body = $rawBody | ConvertFrom-Json
      if ($body.error) { Write-Host "error: $($body.error)" }
      if ($body.message) { Write-Host "message: $($body.message)" }
    } catch {
      Write-Host $rawBody
    }
  } else {
    Write-Host $_.Exception.Message
  }
  exit 1
}

Print-FalStatus $result
