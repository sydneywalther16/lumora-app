param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [ValidateSet("front_angle", "side_angle_left", "side_angle_right", "full_body", "all")]
  [string]$ReferenceRole = "all",
  [ValidateSet("reference_images", "image_to_video", "text_only")]
  [string]$Variant = "reference_images",
  [int]$MaxPaidAttempts = 1,
  [switch]$ConfirmBroadTest,
  [string]$UserId = "",
  [int]$TimeoutSeconds = 300
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
      Write-Host "error category: $($body.error)"
      if ($body.message) { Write-Host "message: $($body.message)" }
      if ($body.sourcesChecked) {
        Write-Host "sources checked:"
        foreach ($source in $body.sourcesChecked) { Write-Host "  - $source" }
      }
      if ($body.recommendedNextAction) { Write-Host "recommended next action: $($body.recommendedNextAction)" }
      return
    } catch {
      Write-Host $rawBody
      return
    }
  }
  Write-Host $ErrorRecord.Exception.Message
}

function Print-Result {
  param($Result)
  if ($Result.candidate) {
    Write-Host "candidate role: $($Result.candidate.role)"
    Write-Host "candidate label: $($Result.candidate.label)"
    Write-Host "candidate host: $($Result.candidate.host)"
  } elseif ($Result.selectedReference) {
    Write-Host "candidate role: $($Result.selectedReference.role)"
    Write-Host "candidate label: $($Result.selectedReference.label)"
    Write-Host "candidate host: $($Result.selectedReference.host)"
  }
  Write-Host "reachable: $($Result.referenceAssetReachable)"
  Write-Host "provider prediction created: $($Result.providerPredictionIdExists)"
  Write-Host "provider status: $($Result.providerStatus)"
  Write-Host "output present: $($Result.outputUrlPresent)"
  Write-Host "parsed video URL present: $($Result.parsedOutputUrlPresent)"
  Write-Host "failure category: $($Result.errorCategory)"
  Write-Host "provider error summary: $($Result.providerErrorSummary)"
  Write-Host "recommended next action: $($Result.nextAction)"
}

$path = "/api/diagnostics/seedance-reference-matrix/self"
$startUrl = Join-ApiUrl $ApiBaseUrl $path

if ($MaxPaidAttempts -gt 1 -and -not $ConfirmBroadTest) {
  Write-Host "MaxPaidAttempts greater than 1 may consume multiple provider credits."
  Write-Host "Rerun with -ConfirmBroadTest to intentionally test more than one reference route."
  exit 1
}

$body = @{
  referenceRole = $ReferenceRole
  variant = $Variant
  maxPaidAttempts = $MaxPaidAttempts
}
if ($ConfirmBroadTest) { $body.confirmBroadTest = $true }
if (-not [string]::IsNullOrWhiteSpace($UserId)) { $body.userId = $UserId }

Write-Host "Starting Seedance reference matrix canary..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Route: $path"
Write-Host "ReferenceRole: $ReferenceRole"
Write-Host "Variant: $Variant"
Write-Host "MaxPaidAttempts: $MaxPaidAttempts"

try {
  $start = Invoke-RestMethod -Method Post -Uri $startUrl -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 8) -TimeoutSec 45
} catch {
  Print-ErrorResponse $_
  exit 1
}

Write-Host "attempts started: $($start.attemptsStarted)"
Write-Host "recommended next action: $($start.recommendedNextAction)"

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$finalResults = @()

foreach ($result in @($start.results)) {
  Print-Result $result
  if (-not $result.canaryJobId) {
    $finalResults += $result
    continue
  }

  $statusUrl = Join-ApiUrl $ApiBaseUrl ("/api/diagnostics/seedance-canary/{0}" -f $result.canaryJobId)
  $status = $result
  while ((Get-Date) -lt $deadline -and $status.lifecycleStatus -notin @("completed", "failed", "canceled")) {
    $sleepSeconds = 5
    if ($status.lifecycleStatus -eq "rate_limited" -and $status.retryAfterSeconds) {
      $sleepSeconds = [Math]::Max(5, [Math]::Min(60, [int]$status.retryAfterSeconds))
    }
    Write-Host "Polling $($result.canaryJobId) in $sleepSeconds seconds..."
    Start-Sleep -Seconds $sleepSeconds
    try {
      $status = Invoke-RestMethod -Method Get -Uri $statusUrl -TimeoutSec 45
    } catch {
      Write-Host "Status poll failed: $($_.Exception.Message)"
      continue
    }
    Print-Result $status
  }
  $finalResults += $status
}

Write-Host ""
Write-Host "Final matrix summary"
foreach ($result in $finalResults) {
  Print-Result $result
  Write-Host "---"
}
