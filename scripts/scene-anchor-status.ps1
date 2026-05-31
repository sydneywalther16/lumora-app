param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

function Join-ApiUrl {
  param([string]$Base, [string]$Path)
  return ($Base.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Print-SceneAnchorStatus {
  param($Diagnostics)

  $SceneAnchor = $Diagnostics.sceneAnchor
  if (-not $SceneAnchor) {
    Write-Host "scene anchor diagnostics: unavailable"
    return
  }

  Write-Host "scene anchor enabled: $($SceneAnchor.enabled)"
  Write-Host "scene anchor configured: $($SceneAnchor.configured)"
  Write-Host "provider: $($SceneAnchor.provider)"
  Write-Host "model: $($SceneAnchor.model)"
  Write-Host "fallback mode: $($SceneAnchor.fallbackMode)"
  if ($SceneAnchor.missingConfig -and $SceneAnchor.missingConfig.Count -gt 0) {
    Write-Host "missing config: $($SceneAnchor.missingConfig -join ', ')"
  }
  Write-Host "last failure category: $($SceneAnchor.lastFailureCategory)"
  Write-Host "last provider status: $($SceneAnchor.lastProviderStatus)"
  Write-Host "fal HTTP status: $($SceneAnchor.falHttpStatus)"
  Write-Host "fal error type: $($SceneAnchor.falErrorType)"
  if ($SceneAnchor.falErrorMessage) {
    Write-Host "fal error message: $($SceneAnchor.falErrorMessage)"
  }
  if ($SceneAnchor.falErrorBodyRedacted) {
    Write-Host "fal error body redacted: $($SceneAnchor.falErrorBodyRedacted)"
  }
  if ($SceneAnchor.lastProviderErrorSummary) {
    Write-Host "last provider error summary: $($SceneAnchor.lastProviderErrorSummary)"
  }
  if ($SceneAnchor.lastPayloadShapeSummary) {
    $shape = $SceneAnchor.lastPayloadShapeSummary
    if ($shape.fieldNames) { Write-Host "payload fields: $($shape.fieldNames -join ', ')" }
    Write-Host "planned reference count: $($shape.plannedReferenceCount)"
    Write-Host "submitted reference count: $($shape.submittedReferenceCount)"
    Write-Host "reference count submitted: $($shape.submittedReferenceCount)"
    if ($shape.submittedReferenceRoles) { Write-Host "submitted reference roles: $($shape.submittedReferenceRoles -join ', ')" }
    if ($shape.droppedReferenceRoles) { Write-Host "dropped reference roles: $($shape.droppedReferenceRoles -join ', ')" }
    Write-Host "provider reference limit: $($shape.providerReferenceLimit)"
  }
  Write-Host "output parsed: $($SceneAnchor.outputParsed)"
  Write-Host "private URLs redacted: $($SceneAnchor.privateUrlsRedacted)"
  if ($SceneAnchor.recommendedNextAction) {
    Write-Host "recommended next action: $($SceneAnchor.recommendedNextAction)"
  }
}

$path = "/api/health/diagnostics"
$url = Join-ApiUrl $ApiBaseUrl $path

Write-Host "Checking scene-anchor diagnostics from server environment..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Route: $path"
Write-Host "No keys or private URLs are read from this PowerShell session or printed."

try {
  $result = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec $TimeoutSeconds
} catch {
  $statusCode = $null
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
    $statusCode = [int]$_.Exception.Response.StatusCode
  }
  Write-Host "Request failed."
  if ($statusCode) { Write-Host "status code: $statusCode" }
  $rawBody = $_.ErrorDetails.Message
  if (-not [string]::IsNullOrWhiteSpace($rawBody)) {
    try {
      $body = $rawBody | ConvertFrom-Json
      if ($body.error) { Write-Host "error: $($body.error)" }
      if ($body.message) { Write-Host "message: $($body.message)" }
    } catch {
      Write-Host $rawBody
    }
  } else {
    Write-Host $_.Exception.Message
  }
  exit 1
}

Print-SceneAnchorStatus $result
