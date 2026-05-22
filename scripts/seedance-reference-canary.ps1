param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [string]$UserId = "",
  [switch]$SaveAsDraft,
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"

function Join-ApiUrl {
  param(
    [string]$Base,
    [string]$Path
  )
  return ($Base.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Canary-Summary {
  param($Status)
  if (-not $Status.providerPredictionIdExists) { return "Prediction created false." }
  if ($Status.lifecycleStatus -eq "rate_limited") { return "Rate limited until $($Status.retryAvailableAt)." }
  if ($Status.lifecycleStatus -eq "completed" -and $Status.parsedOutputUrlPresent) { return "Succeeded with video URL." }
  if ($Status.lifecycleStatus -eq "rendering") { return "Still processing." }
  if ($Status.lifecycleStatus -eq "failed") {
    switch ($Status.errorCategory) {
      "reference_moderation" { return "Failed because provider moderation blocked the reference path." }
      "reference_moderation_block" { return "Failed because provider moderation blocked this reference path." }
      "reference_input_schema" { return "Failed because reference input schema was invalid." }
      "reference_asset_access" { return "Failed because selected reference asset was not accessible." }
      "reference_output_missing" { return "Failed because provider output was missing." }
      default { return "Failed: $($Status.errorCategory)" }
    }
  }
  if ($Status.lifecycleStatus -eq "canceled") { return "Prediction canceled." }
  return $Status.message
}

function Print-ErrorResponse {
  param($ErrorRecord)

  $statusCode = $null
  if ($ErrorRecord.Exception.Response -and $ErrorRecord.Exception.Response.StatusCode) {
    $statusCode = [int]$ErrorRecord.Exception.Response.StatusCode
  }

  $rawBody = $ErrorRecord.ErrorDetails.Message
  $body = $null
  if (-not [string]::IsNullOrWhiteSpace($rawBody)) {
    try {
      $body = $rawBody | ConvertFrom-Json
    } catch {
      $body = $null
    }
  }

  Write-Host "Request failed."
  if ($statusCode) { Write-Host "status code: $statusCode" }

  if ($body) {
    Write-Host "error category: $($body.error)"
    if ($body.message) { Write-Host "message: $($body.message)" }
    if ($body.sourcesChecked) {
      Write-Host "sources checked:"
      foreach ($source in $body.sourcesChecked) {
        Write-Host "  - $source"
      }
    }
    if ($body.recommendedNextAction) {
      Write-Host "recommended next action: $($body.recommendedNextAction)"
    }
    if ($body.candidates) {
      Write-Host "candidate count: $($body.candidates.Count)"
    }
    return
  }

  if (-not [string]::IsNullOrWhiteSpace($rawBody)) {
    Write-Host $rawBody
  } else {
    Write-Host $ErrorRecord.Exception.Message
  }
}

$referenceCanaryPath = "/api/diagnostics/seedance-reference-canary/self"
$startUrl = Join-ApiUrl $ApiBaseUrl $referenceCanaryPath
$body = @{ saveAsDraft = [bool]$SaveAsDraft }
if (-not [string]::IsNullOrWhiteSpace($UserId)) { $body.userId = $UserId }

Write-Host "Starting Seedance self-reference canary..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Route: $referenceCanaryPath"

try {
  $start = Invoke-RestMethod -Method Post -Uri $startUrl -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 5) -TimeoutSec 45
} catch {
  Print-ErrorResponse $_
  exit 1
}

Write-Host "canaryJobId: $($start.canaryJobId)"
Write-Host "prediction created: $($start.providerPredictionIdExists)"
Write-Host "provider status: $($start.providerStatus)"
Write-Host "variant: $($start.canaryVariant)"
if ($start.selectedReference) {
  Write-Host "selected reference label: $($start.selectedReference.label)"
  Write-Host "selected reference role: $($start.selectedReference.role)"
  Write-Host "selected reference host: $($start.selectedReference.host)"
  Write-Host "selected reference savedToLumora: $($start.selectedReference.savedToLumora)"
  Write-Host "selected reference reachable: $($start.selectedReference.reachable)"
  Write-Host "selected reference content type: $($start.selectedReference.contentType)"
}
if ($start.providerErrorSummary) { Write-Host "provider error summary: $($start.providerErrorSummary)" }
Write-Host "recommended next action: $($start.nextAction)"
Write-Host (Canary-Summary $start)

$statusUrl = Join-ApiUrl $ApiBaseUrl ("/api/diagnostics/seedance-canary/{0}" -f $start.canaryJobId)
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$status = $start

while ((Get-Date) -lt $deadline) {
  if ($status.lifecycleStatus -in @("completed", "failed", "canceled")) { break }

  $sleepSeconds = 5
  if ($status.lifecycleStatus -eq "rate_limited" -and $status.retryAfterSeconds) {
    $sleepSeconds = [Math]::Max(5, [Math]::Min(60, [int]$status.retryAfterSeconds))
    Write-Host "Rate limited. Waiting $sleepSeconds seconds."
  } else {
    Write-Host "Polling in $sleepSeconds seconds..."
  }
  Start-Sleep -Seconds $sleepSeconds

  try {
    $status = Invoke-RestMethod -Method Get -Uri $statusUrl -TimeoutSec 45
  } catch {
    Write-Host "Status poll failed: $($_.Exception.Message)"
    continue
  }

  Write-Host "status: $($status.lifecycleStatus), provider: $($status.providerStatus), next: $($status.nextAction)"
  if ($status.providerErrorSummary) { Write-Host "provider error summary: $($status.providerErrorSummary)" }
  Write-Host (Canary-Summary $status)
}

Write-Host ""
Write-Host "Final summary"
Write-Host "canaryJobId: $($status.canaryJobId)"
Write-Host "prediction created: $($status.providerPredictionIdExists)"
Write-Host "provider status: $($status.providerStatus)"
Write-Host "variant: $($status.canaryVariant)"
Write-Host "selected reference label: $($status.selectedReference.label)"
Write-Host "selected reference role: $($status.selectedReference.role)"
Write-Host "selected reference reachable: $($status.selectedReference.reachable)"
Write-Host "selected reference content type: $($status.selectedReference.contentType)"
Write-Host "output present: $($status.outputUrlPresent)"
Write-Host "parsed video URL present: $($status.parsedOutputUrlPresent)"
Write-Host "failure category: $($status.errorCategory)"
Write-Host "provider error category: $($status.providerErrorCategory)"
Write-Host "provider error summary: $($status.providerErrorSummary)"
if ($status.providerLogsExcerpt) { Write-Host "provider logs excerpt: $($status.providerLogsExcerpt)" }
Write-Host "recommended next action: $($status.nextAction)"
Write-Host (Canary-Summary $status)

if ((Get-Date) -ge $deadline -and $status.lifecycleStatus -notin @("completed", "failed", "canceled")) {
  Write-Host "Timed out waiting for terminal reference canary status."
  exit 2
}
