param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [string]$UserId = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Join-ApiUrl {
  param([string]$Base, [string]$Path)
  return ($Base.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Print-NormalizationStatus {
  param($Result)

  Write-Host "ok: $($Result.ok)"
  Write-Host "verification video present: $($Result.verificationVideoPresent)"
  Write-Host "verification consent present: $($Result.verificationConsentPresent)"
  Write-Host "provider prediction created: $($Result.providerPredictionCreated)"
  Write-Host "normalized asset used: $($Result.normalizedAssetUsed)"
  Write-Host "normalization triggered: $($Result.normalizationTriggered)"
  Write-Host "normalization reason: $($Result.normalizationReason)"
  if ($Result.normalizationErrorCategory) { Write-Host "normalization error category: $($Result.normalizationErrorCategory)" }
  if ($null -ne $Result.normalizationExitCode) { Write-Host "normalization exit code: $($Result.normalizationExitCode)" }
  if ($Result.normalizationEncoderFallbackUsed) { Write-Host "normalization encoder fallback used: $($Result.normalizationEncoderFallbackUsed)" }
  if ($Result.selectedVerificationVideo -and $Result.selectedVerificationVideo.preflight) {
    $meta = $Result.selectedVerificationVideo.preflight
    Write-Host ("original preflight: duration={0}s size={1} width={2} height={3} container={4} videoCodec={5} audioCodec={6} ok={7} reason={8}" -f $meta.durationSeconds, $meta.fileSizeBytes, $meta.width, $meta.height, $meta.container, $meta.videoCodec, $meta.audioCodec, $meta.preflightOk, $meta.preflightFailureReason)
  }
  if ($Result.selectedVerificationVideo -and $Result.selectedVerificationVideo.normalizedPreflight) {
    $meta = $Result.selectedVerificationVideo.normalizedPreflight
    Write-Host ("normalized preflight: duration={0}s size={1} width={2} height={3} container={4} videoCodec={5} audioCodec={6} ok={7} reason={8}" -f $meta.durationSeconds, $meta.fileSizeBytes, $meta.width, $meta.height, $meta.container, $meta.videoCodec, $meta.audioCodec, $meta.preflightOk, $meta.preflightFailureReason)
  }
  if ($Result.normalizationStderrExcerpt) { Write-Host "normalization stderr: $($Result.normalizationStderrExcerpt)" }
  if ($Result.message) { Write-Host "message: $($Result.message)" }
  if ($Result.recommendedNextAction) { Write-Host "recommended next action: $($Result.recommendedNextAction)" }
}

function Print-ErrorResponse {
  param($ErrorRecord)

  Write-Host "Request failed."
  if ($ErrorRecord.Exception.Response -and $ErrorRecord.Exception.Response.StatusCode) {
    Write-Host "status code: $([int]$ErrorRecord.Exception.Response.StatusCode)"
  }

  $rawBody = $ErrorRecord.ErrorDetails.Message
  if (-not [string]::IsNullOrWhiteSpace($rawBody)) {
    try {
      $body = $rawBody | ConvertFrom-Json
      Print-NormalizationStatus $body
      return
    } catch {
      Write-Host $rawBody
      return
    }
  }

  Write-Host $ErrorRecord.Exception.Message
}

$path = "/api/diagnostics/normalize-verification-video/self"
$url = Join-ApiUrl $ApiBaseUrl $path
$body = @{}
if (-not [string]::IsNullOrWhiteSpace($UserId)) { $body.userId = $UserId }
if ($Force.IsPresent) { $body.force = $true }

Write-Host "Normalizing self verification video..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Route: $path"
Write-Host "Force: $($Force.IsPresent)"
Write-Host "No provider prediction will be created by this diagnostic."

try {
  $result = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6) -TimeoutSec 120
} catch {
  Print-ErrorResponse $_
  exit 1
}

Print-NormalizationStatus $result
if (-not $result.ok) { exit 2 }
