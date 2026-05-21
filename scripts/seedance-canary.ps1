param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [switch]$Reference,
  [string]$UserId = "",
  [string]$CharacterId = "",
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

function Redact-Url {
  param([string]$Url)
  if ([string]::IsNullOrWhiteSpace($Url)) { return $Url }
  if ($env:DEBUG_CANARY_URLS -eq "true") { return $Url }
  try {
    $uri = [Uri]$Url
    return "[redacted-url host=$($uri.Host)]"
  } catch {
    return "[redacted-url]"
  }
}

function Canary-Summary {
  param($Status)
  if (-not $Status.providerPredictionIdExists) { return "Prediction was not created yet." }
  if ($Status.lifecycleStatus -eq "rate_limited") {
    return "Rate limited until $($Status.retryAvailableAt)."
  }
  if ($Status.lifecycleStatus -eq "completed" -and $Status.parsedOutputUrlPresent) {
    return "Succeeded with video URL."
  }
  if ($Status.lifecycleStatus -eq "rendering") {
    return "Still processing."
  }
  if ($Status.lifecycleStatus -eq "failed") {
    switch ($Status.errorCategory) {
      "provider_moderation" { return "Failed because provider moderation." }
      "input_schema_invalid" { return "Failed because input schema." }
      "output_missing" { return "Failed because output missing." }
      "unsupported_output_shape" { return "Failed because output parser rejected the shape." }
      "provider_output_unreachable" { return "Failed because output URL was unreachable." }
      default { return "Failed: $($Status.errorCategory)" }
    }
  }
  if ($Status.lifecycleStatus -eq "canceled") { return "Prediction canceled." }
  return $Status.message
}

$startPath = if ($Reference) { "/api/diagnostics/seedance-reference-canary" } else { "/api/diagnostics/seedance-canary" }
$startUrl = Join-ApiUrl $ApiBaseUrl $startPath

$body = @{ saveAsDraft = [bool]$SaveAsDraft }
if (-not [string]::IsNullOrWhiteSpace($UserId)) { $body.userId = $UserId }
if ($Reference) {
  if ([string]::IsNullOrWhiteSpace($CharacterId)) {
    throw "Reference canary requires -CharacterId."
  }
  $body.characterId = $CharacterId
}

Write-Host "Starting Seedance canary..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Mode: $(if ($Reference) { 'reference' } else { 'text' })"

try {
  $start = Invoke-RestMethod -Method Post -Uri $startUrl -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 5) -TimeoutSec 45
} catch {
  $response = $_.ErrorDetails.Message
  if ($response) {
    Write-Host $response
  } else {
    Write-Host $_.Exception.Message
  }
  exit 1
}

if (-not $start.canaryJobId) {
  Write-Host "Canary did not return a job id."
  exit 1
}

Write-Host "canaryJobId: $($start.canaryJobId)"
Write-Host "provider: $($start.provider)"
Write-Host "predictionId: $($start.predictionId)"
if ($start.predictionUrl) {
  Write-Host "predictionUrl: $(Redact-Url $start.predictionUrl)"
}
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
  Write-Host (Canary-Summary $status)
}

Write-Host ""
Write-Host "Final summary"
Write-Host "canaryJobId: $($status.canaryJobId)"
Write-Host "prediction created: $($status.providerPredictionIdExists)"
Write-Host "provider status: $($status.providerStatus)"
Write-Host "lifecycle: $($status.lifecycleStatus)"
Write-Host "output present: $($status.outputUrlPresent)"
Write-Host "parsed video URL present: $($status.parsedOutputUrlPresent)"
Write-Host "output shape: $($status.outputShapeSummary)"
Write-Host "error category: $($status.errorCategory)"
Write-Host "next action: $($status.nextAction)"
Write-Host (Canary-Summary $status)

if ((Get-Date) -ge $deadline -and $status.lifecycleStatus -notin @("completed", "failed", "canceled")) {
  Write-Host "Timed out waiting for terminal canary status."
  exit 2
}
