param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [string]$UserId = "",
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

function Join-ApiUrl {
  param([string]$Base, [string]$Path)
  return ($Base.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Print-ErrorResponse {
  param($ErrorRecord)

  $statusCode = $null
  if ($ErrorRecord.Exception.Response -and $ErrorRecord.Exception.Response.StatusCode) {
    $statusCode = [int]$ErrorRecord.Exception.Response.StatusCode
  }

  $rawBody = $ErrorRecord.ErrorDetails.Message
  Write-Host "Request failed."
  if ($statusCode) { Write-Host "status code: $statusCode" }

  if (-not [string]::IsNullOrWhiteSpace($rawBody)) {
    try {
      $body = $rawBody | ConvertFrom-Json
      Write-Host "verification video present: $($body.verificationVideoPresent)"
      Write-Host "provider prediction created: $($body.providerPredictionCreated)"
      Write-Host "provider status: $($body.providerStatus)"
      $outputPresent = $body.outputPresent
      if ($null -eq $outputPresent) { $outputPresent = $body.outputUrlPresent }
      Write-Host "output present: $outputPresent"
      Write-Host "parsed video URL present: $($body.parsedVideoUrlPresent)"
      $failureCategory = $body.failureCategory
      if ($null -eq $failureCategory) { $failureCategory = $body.error }
      Write-Host "failure category: $failureCategory"
      if ($body.providerErrorSummary) { Write-Host "provider error summary: $($body.providerErrorSummary)" }
      if ($body.message) { Write-Host "message: $($body.message)" }
      if ($body.recommendedNextAction) { Write-Host "recommended next action: $($body.recommendedNextAction)" }
      return
    } catch {
      Write-Host $rawBody
      return
    }
  }

  Write-Host $ErrorRecord.Exception.Message
}

$path = "/api/diagnostics/seedance-video-reference-canary/self"
$url = Join-ApiUrl $ApiBaseUrl $path
$body = @{}
if (-not [string]::IsNullOrWhiteSpace($UserId)) { $body.userId = $UserId }

Write-Host "Starting Seedance video-reference canary..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Route: $path"
Write-Host "Warning: this may consume provider credits only after a documented video-reference route is mapped."

try {
  $result = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6) -TimeoutSec $TimeoutSeconds
} catch {
  Print-ErrorResponse $_
  exit 1
}

Write-Host "verification video present: $($result.verificationVideoPresent)"
Write-Host "verification consent present: $($result.verificationConsentPresent)"
Write-Host "provider prediction created: $($result.providerPredictionCreated)"
Write-Host "provider status: $($result.providerStatus)"
$outputPresent = $result.outputPresent
if ($null -eq $outputPresent) { $outputPresent = $result.outputUrlPresent }
Write-Host "output present: $outputPresent"
Write-Host "parsed video URL present: $($result.parsedVideoUrlPresent)"
Write-Host "failure category: $($result.failureCategory)"
if ($result.providerErrorSummary) { Write-Host "provider error summary: $($result.providerErrorSummary)" }
if ($result.recommendedNextAction) { Write-Host "recommended next action: $($result.recommendedNextAction)" }
if ($result.warning) { Write-Host "warning: $($result.warning)" }
