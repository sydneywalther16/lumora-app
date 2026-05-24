param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [string]$UserId = "",
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

Write-Host "Starting Seedance video-reference canary..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Route: $startPath"
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
