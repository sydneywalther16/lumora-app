param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [string]$UserId = "",
  [switch]$SaveAsDraft,
  [switch]$ForceRetest,
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
  Write-Host "readiness status: $($Result.readinessStatus)"
  Write-Host "canary status: $($Result.canaryStatus)"
  if ($Result.attemptMode) { Write-Host "attempt mode: $($Result.attemptMode)" }
  if ($null -ne $Result.storedStatusReturned) { Write-Host "stored status returned: $($Result.storedStatusReturned)" }
  if ($null -ne $Result.freshCanaryAttemptCreated) { Write-Host "fresh canary attempt created: $($Result.freshCanaryAttemptCreated)" }
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

Write-Host "Starting Kling likeness canary..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Route: $path"
Write-Host "Warning: this may consume provider credits."
if ($ForceRetest.IsPresent) {
  Write-Host "ForceRetest: enabled. Stored non-blocking failures will be ignored for this paid attempt."
}

try {
  $result = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6) -TimeoutSec $TimeoutSeconds
} catch {
  Print-ErrorResponse $_
  exit 1
}

Print-CanaryResult $result
