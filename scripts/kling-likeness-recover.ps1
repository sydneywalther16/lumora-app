param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [string]$UserId = "",
  [string]$AttemptId = "",
  [string]$ProviderJobId = "",
  [switch]$SaveAsDraft,
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

function Join-ApiUrl {
  param([string]$Base, [string]$Path)
  return ($Base.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Print-RecoveryResult {
  param($Result)

  Write-Host "recovery: $($Result.recovery)"
  Write-Host "selected model: $($Result.selectedModel)"
  if ($Result.attemptId) { Write-Host "attempt id: $($Result.attemptId)" }
  Write-Host "provider job created: $($Result.providerJobCreated)"
  if ($Result.providerJobId) { Write-Host "provider job id: $($Result.providerJobId)" }
  if ($Result.requestId) { Write-Host "request id: $($Result.requestId)" }
  if ($Result.providerStatus) { Write-Host "provider status: $($Result.providerStatus)" }
  if ($Result.skipStage) { Write-Host "skip stage: $($Result.skipStage)" }
  if ($Result.skipReason) { Write-Host "skip reason: $($Result.skipReason)" }
  if ($Result.pollEndpointUsed) { Write-Host "poll endpoint used: $($Result.pollEndpointUsed)" }
  if ($Result.responseEndpointUsed) { Write-Host "response endpoint used: $($Result.responseEndpointUsed)" }
  if ($Result.statusUrlSource) { Write-Host "status URL source: $($Result.statusUrlSource)" }
  if ($Result.responseUrlSource) { Write-Host "response URL source: $($Result.responseUrlSource)" }
  if ($Result.pollErrorType) { Write-Host "poll error type: $($Result.pollErrorType)" }
  if ($Result.pollErrorMessage) { Write-Host "poll error message: $($Result.pollErrorMessage)" }
  if ($Result.outputClassification) { Write-Host "output classification: $($Result.outputClassification)" }
  Write-Host "output present: $($Result.outputUrlPresent)"
  Write-Host "parsed video URL present: $($Result.parsedVideoUrlPresent)"
  Write-Host "verified video present: $($Result.verifiedVideoPresent)"
  Write-Host "verified persisted video: $($Result.verifiedPersistedVideo)"
  if ($Result.failureCategory) { Write-Host "failure category: $($Result.failureCategory)" }
  if ($Result.providerErrorSummary) { Write-Host "provider error summary: $($Result.providerErrorSummary)" }
  if ($Result.recommendedNextAction) { Write-Host "recommended next action: $($Result.recommendedNextAction)" }
  if ($Result.warning) { Write-Host "warning: $($Result.warning)" }
}

function Print-ErrorResponse {
  param($ErrorRecord)

  $statusCode = $null
  $rawBody = $ErrorRecord.ErrorDetails.Message
  if ($ErrorRecord.Exception.Response -and $ErrorRecord.Exception.Response.StatusCode) {
    $statusCode = [int]$ErrorRecord.Exception.Response.StatusCode
  }

  Write-Host "Request failed."
  if ($statusCode) { Write-Host "status code: $statusCode" }
  if (-not [string]::IsNullOrWhiteSpace($rawBody)) {
    try {
      $body = $rawBody | ConvertFrom-Json
      Print-RecoveryResult $body
      if ($body.error) { Write-Host "error: $($body.error)" }
      if ($body.message) { Write-Host "message: $($body.message)" }
      return
    } catch {
      Write-Host $rawBody
      return
    }
  }

  Write-Host $ErrorRecord.Exception.Message
}

$path = "/api/diagnostics/kling-likeness-canary/recover"
$url = Join-ApiUrl $ApiBaseUrl $path
$body = @{}
if (-not [string]::IsNullOrWhiteSpace($UserId)) { $body.userId = $UserId }
if (-not [string]::IsNullOrWhiteSpace($AttemptId)) { $body.attemptId = $AttemptId }
if (-not [string]::IsNullOrWhiteSpace($ProviderJobId)) { $body.providerJobId = $ProviderJobId }
if ($SaveAsDraft.IsPresent) { $body.saveAsDraft = $true }

Write-Host "Recovering existing Kling likeness canary job..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Route: $path"
Write-Host "No new provider job will be created."

try {
  $result = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6) -TimeoutSec $TimeoutSeconds
} catch {
  Print-ErrorResponse $_
  exit 1
}

Print-RecoveryResult $result
