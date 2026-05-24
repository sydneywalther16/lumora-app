param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [string]$UserId = "",
  [ValidateSet("reference_videos_bracket", "reference_videos_at", "video_urls_at")]
  [string]$Variant = "reference_videos_bracket",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

function Join-ApiUrl {
  param([string]$Base, [string]$Path)
  return ($Base.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Print-CanaryStatus {
  param($Result)

  Write-Host "canary job id: $($Result.canaryJobId)"
  Write-Host "verification video present: $($Result.verificationVideoPresent)"
  Write-Host "verification consent present: $($Result.verificationConsentPresent)"
  Write-Host "provider prediction created: $($Result.providerPredictionCreated)"
  if ($Result.canaryVariant) { Write-Host "variant: $($Result.canaryVariant)" }
  if ($Result.referenceFieldName) { Write-Host "field name: $($Result.referenceFieldName)" }
  if ($Result.promptTokenStyle) { Write-Host "prompt token style: $($Result.promptTokenStyle)" }
  if ($Result.selectedVerificationVideo) {
    Write-Host "normalized asset used: $($Result.selectedVerificationVideo.normalizedAssetUsed)"
    if ($Result.selectedVerificationVideo.preflight) {
      $meta = $Result.selectedVerificationVideo.preflight
      Write-Host ("preflight: duration={0}s size={1} width={2} height={3} container={4} videoCodec={5} audioCodec={6} ok={7} reason={8}" -f $meta.durationSeconds, $meta.fileSizeBytes, $meta.width, $meta.height, $meta.container, $meta.videoCodec, $meta.audioCodec, $meta.preflightOk, $meta.preflightFailureReason)
    }
    if ($Result.selectedVerificationVideo.normalizedPreflight) {
      $meta = $Result.selectedVerificationVideo.normalizedPreflight
      Write-Host ("normalized preflight: duration={0}s size={1} width={2} height={3} container={4} videoCodec={5} audioCodec={6} ok={7} reason={8}" -f $meta.durationSeconds, $meta.fileSizeBytes, $meta.width, $meta.height, $meta.container, $meta.videoCodec, $meta.audioCodec, $meta.preflightOk, $meta.preflightFailureReason)
    }
  }
  Write-Host "provider status: $($Result.providerStatus)"
  $outputPresent = $Result.outputPresent
  if ($null -eq $outputPresent) { $outputPresent = $Result.outputUrlPresent }
  Write-Host "output present: $outputPresent"
  $parsedPresent = $Result.parsedVideoUrlPresent
  if ($null -eq $parsedPresent) { $parsedPresent = $Result.parsedOutputUrlPresent }
  Write-Host "parsed video URL present: $parsedPresent"
  $failureCategory = $Result.failureCategory
  if ($null -eq $failureCategory) { $failureCategory = $Result.errorCategory }
  if ($null -eq $failureCategory) { $failureCategory = $Result.error }
  Write-Host "failure category: $failureCategory"
  if ($failureCategory -eq "video_reference_provider_unavailable") {
    Write-Host "Provider accepted the request and began processing."
    Write-Host "Seedance video-reference route was not proven or disproven."
    Write-Host "Provider was temporarily unavailable."
    Write-Host "Wait and retry later."
    Write-Host "Transient provider outage. Do not rerun immediately unless you want to spend another provider attempt."
  }
  if ($failureCategory -eq "video_reference_input_invalid") {
    Write-Host "Provider reached Seedance, but the video-reference input was invalid."
    Write-Host "Do not retry the same payload blindly. Normalize the video or try one schema variant at a time."
  }
  if ($failureCategory -eq "verification_video_preflight_failed") {
    Write-Host "Verification video failed local preflight. Prepare a provider-safe MP4 before spending another attempt."
  }
  if ($Result.retryAvailableAt) { Write-Host "retry available at: $($Result.retryAvailableAt)" }
  if ($Result.providerErrorSummary) { Write-Host "provider error summary: $($Result.providerErrorSummary)" }
  if ($Result.redactedErrorDetail) { Write-Host "error detail: $($Result.redactedErrorDetail)" }
  if ($Result.recommendedNextAction) { Write-Host "recommended next action: $($Result.recommendedNextAction)" }
  elseif ($Result.nextAction) { Write-Host "recommended next action: $($Result.nextAction)" }
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
      Print-CanaryStatus $body
      if ($body.message) { Write-Host "message: $($body.message)" }
      return
    } catch {
      Write-Host $rawBody
      return
    }
  }

  Write-Host $ErrorRecord.Exception.Message
}

$startPath = "/api/diagnostics/seedance-video-reference-canary/self"
$startUrl = Join-ApiUrl $ApiBaseUrl $startPath
$body = @{}
if (-not [string]::IsNullOrWhiteSpace($UserId)) { $body.userId = $UserId }
$body.variant = $Variant

Write-Host "Starting Seedance video-reference canary..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Route: $startPath"
Write-Host "Variant: $Variant"
Write-Host "Warning: this may consume provider credits."

try {
  $result = Invoke-RestMethod -Method Post -Uri $startUrl -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6) -TimeoutSec 60
} catch {
  Print-ErrorResponse $_
  exit 1
}

Print-CanaryStatus $result

if (-not $result.canaryJobId) {
  if ($result.warning) { Write-Host "warning: $($result.warning)" }
  exit 0
}

$statusUrl = Join-ApiUrl $ApiBaseUrl ("/api/diagnostics/seedance-canary/{0}" -f $result.canaryJobId)
$startedAt = Get-Date
while ($true) {
  if (((Get-Date) - $startedAt).TotalSeconds -ge $TimeoutSeconds) {
    Write-Host "Timed out waiting for terminal canary status."
    exit 2
  }

  Start-Sleep -Seconds 5
  try {
    $status = Invoke-RestMethod -Method Get -Uri $statusUrl -TimeoutSec 60
  } catch {
    Print-ErrorResponse $_
    exit 1
  }

  Write-Host ""
  Print-CanaryStatus $status

  if ($status.status -in @("completed", "failed", "canceled") -or $status.lifecycleStatus -in @("completed", "failed", "canceled")) {
    if ($status.status -eq "completed" -or $status.lifecycleStatus -eq "completed") {
      Write-Host "Succeeded with video URL: $($status.parsedVideoUrlPresent)"
    }
    break
  }

  if ($status.status -eq "rate_limited" -or $status.lifecycleStatus -eq "rate_limited") {
    Write-Host "Rate limited until: $($status.retryAvailableAt)"
  } else {
    Write-Host "Still processing..."
  }
}
