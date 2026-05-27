param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [string]$UserId = "",
  [switch]$SaveAsDraft,
  [switch]$ForceRetest,
  [ValidateSet("", "configured", "o1_reference_to_video", "o1_standard_reference_to_video", "elements_standard")]
  [string]$Variant = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

function Join-ApiUrl {
  param([string]$Base, [string]$Path)
  return ($Base.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Print-CanaryResult {
  param($Result)

  Write-Host "provider configured: $($Result.configured)"
  Write-Host "selected model: $($Result.selectedModel)"
  if ($Result.modelSlug) { Write-Host "model slug: $($Result.modelSlug)" }
  Write-Host "readiness status: $($Result.readinessStatus)"
  Write-Host "canary status: $($Result.canaryStatus)"
  if ($Result.attemptMode) { Write-Host "attempt mode: $($Result.attemptMode)" }
  if ($null -ne $Result.forceRetestRequested) { Write-Host "force retest requested: $($Result.forceRetestRequested)" }
  if ($null -ne $Result.forceRetestHonored) { Write-Host "force retest honored: $($Result.forceRetestHonored)" }
  if ($null -ne $Result.storedStatusIgnored) { Write-Host "stored status ignored: $($Result.storedStatusIgnored)" }
  if ($Result.reasonIfNotHonored) { Write-Host "reason if not honored: $($Result.reasonIfNotHonored)" }
  if ($null -ne $Result.storedStatusReturned) { Write-Host "stored status returned: $($Result.storedStatusReturned)" }
  if ($null -ne $Result.freshCanaryAttemptCreated) { Write-Host "fresh canary attempt created: $($Result.freshCanaryAttemptCreated)" }
  if ($null -ne $Result.attemptCreated) { Write-Host "attempt created: $($Result.attemptCreated)" }
  if ($Result.attemptId) { Write-Host "attempt id: $($Result.attemptId)" }
  if ($Result.skipStage) { Write-Host "skip stage: $($Result.skipStage)" }
  if ($Result.skipReason) { Write-Host "skip reason: $($Result.skipReason)" }
  if ($Result.providerJobId) { Write-Host "provider job id: $($Result.providerJobId)" }
  if ($Result.requestId) { Write-Host "request id: $($Result.requestId)" }
  if ($Result.providerStatusUrl) { Write-Host "provider status url: $($Result.providerStatusUrl)" }
  if ($Result.pollEndpointUsed) { Write-Host "poll endpoint used: $($Result.pollEndpointUsed)" }
  if ($Result.pollErrorType) { Write-Host "poll error type: $($Result.pollErrorType)" }
  if ($Result.pollErrorMessage) { Write-Host "poll error message: $($Result.pollErrorMessage)" }
  if ($Result.endpointUsed) { Write-Host "endpoint used: $($Result.endpointUsed)" }
  if ($null -ne $Result.falHttpStatus) { Write-Host "fal HTTP status: $($Result.falHttpStatus)" }
  if ($Result.falErrorType) { Write-Host "fal error type: $($Result.falErrorType)" }
  if ($Result.falErrorMessage) { Write-Host "fal error message: $($Result.falErrorMessage)" }
  if ($Result.falErrorBodyRedacted) { Write-Host "fal error body redacted: $($Result.falErrorBodyRedacted)" }
  if ($Result.payloadShapeSummary) {
    $shape = $Result.payloadShapeSummary
    Write-Host "payload imageUrlsCount: $($shape.imageUrlsCount)"
    Write-Host "payload elementsCount: $($shape.elementsCount)"
    Write-Host "payload hasPrompt: $($shape.hasPrompt)"
    Write-Host "payload promptTokenStyle: $($shape.promptTokenStyle)"
    Write-Host "payload privateUrlsRedacted: $($shape.privateUrlsRedacted)"
    if ($shape.fieldNames) {
      Write-Host "payload fields: $($shape.fieldNames -join ', ')"
    }
  }
  Write-Host "reference count: $($Result.referenceCount)"
  Write-Host "verification video used: $($Result.verificationVideoUsed)"
  Write-Host "provider prediction/job created: $($Result.providerJobCreated)"
  Write-Host "provider status: $($Result.providerStatus)"
  Write-Host "output present: $($Result.outputUrlPresent)"
  Write-Host "parsed video URL present: $($Result.parsedVideoUrlPresent)"
  Write-Host "verified persisted video: $($Result.verifiedPersistedVideo)"
  if ($Result.selectedReferenceRole) { Write-Host "selected reference role: $($Result.selectedReferenceRole)" }
  if ($Result.selectedReferenceLabel) { Write-Host "selected reference label: $($Result.selectedReferenceLabel)" }
  if ($Result.failureCategory) { Write-Host "failure category: $($Result.failureCategory)" }
  if ($Result.providerErrorSummary) { Write-Host "provider error summary: $($Result.providerErrorSummary)" }
  if ($Result.recommendedNextAction) { Write-Host "recommended next action: $($Result.recommendedNextAction)" }
  if ($Result.failureCategory -eq "kling_poll_failed" -and $Result.attemptId) {
    Write-Host "recovery suggestion: .\scripts\kling-likeness-recover.ps1 -ApiBaseUrl `"$ApiBaseUrl`" -AttemptId `"$($Result.attemptId)`""
  }
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
      Print-CanaryResult $body
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

$path = "/api/diagnostics/kling-likeness-canary/self"
$url = Join-ApiUrl $ApiBaseUrl $path
$body = @{}
if (-not [string]::IsNullOrWhiteSpace($UserId)) { $body.userId = $UserId }
if ($SaveAsDraft.IsPresent) { $body.saveAsDraft = $true }
if ($ForceRetest.IsPresent) { $body.forceRetest = $true }
if (-not [string]::IsNullOrWhiteSpace($Variant)) { $body.variant = $Variant }

Write-Host "Starting Kling likeness canary..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Route: $path"
Write-Host "Warning: this may consume provider credits."
if ($ForceRetest.IsPresent) {
  Write-Host "ForceRetest: enabled. Stored non-blocking failures will be ignored for this paid attempt."
}
if (-not [string]::IsNullOrWhiteSpace($Variant)) {
  Write-Host "Variant: $Variant"
}

try {
  $result = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6) -TimeoutSec $TimeoutSeconds
} catch {
  Print-ErrorResponse $_
  exit 1
}

Print-CanaryResult $result
