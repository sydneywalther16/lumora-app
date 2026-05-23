param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [string]$UserId = "",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$base = $ApiBaseUrl.TrimEnd("/")
$body = @{}
if ($UserId.Trim()) {
  $body.userId = $UserId.Trim()
}

Write-Host "Starting exact likeness canary..."
Write-Host "Endpoint: $base/api/diagnostics/exact-likeness-canary/self"
Write-Host "Warning: this may consume provider credits when enabled."

try {
  $response = Invoke-WebRequest `
    -Uri "$base/api/diagnostics/exact-likeness-canary/self" `
    -Method Post `
    -ContentType "application/json" `
    -Body ($body | ConvertTo-Json -Depth 6) `
    -UseBasicParsing `
    -TimeoutSec $TimeoutSeconds
  $payload = $response.Content | ConvertFrom-Json
} catch {
  $statusCode = $null
  $responseBody = $null
  if ($_.Exception.Response) {
    $statusCode = [int]$_.Exception.Response.StatusCode
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $responseBody = $reader.ReadToEnd()
    } catch {
      $responseBody = $null
    }
  }

  Write-Host "Request failed."
  if ($statusCode) { Write-Host "Status code: $statusCode" }
  if ($responseBody) {
    try {
      $payload = $responseBody | ConvertFrom-Json
      if ($payload.error) { Write-Host "Error: $($payload.error)" }
      if ($payload.message) { Write-Host "Message: $($payload.message)" }
      if ($payload.failureCategory) { Write-Host "Failure category: $($payload.failureCategory)" }
      if ($payload.recommendedNextAction) { Write-Host "Recommended next action: $($payload.recommendedNextAction)" }
    } catch {
      Write-Host $responseBody
    }
  } else {
    Write-Host $_.Exception.Message
  }
  exit 1
}

Write-Host "Provider: $($payload.provider)"
Write-Host "Route: $($payload.route)"
Write-Host "Configured: $($payload.configured)"
Write-Host "Canary status: $($payload.canaryStatus)"
Write-Host "Output URL present: $($payload.outputUrlPresent)"
Write-Host "Verified video present: $($payload.verifiedVideoPresent)"
if ($payload.status) { Write-Host "Status: $($payload.status)" }
if ($payload.failureCategory) { Write-Host "Failure category: $($payload.failureCategory)" }
if ($payload.exactLikenessRouterChoice) {
  Write-Host "Router route: $($payload.exactLikenessRouterChoice.route)"
  Write-Host "Router provider: $($payload.exactLikenessRouterChoice.provider)"
  Write-Host "Exact likeness available: $($payload.exactLikenessRouterChoice.exactLikeness)"
  Write-Host "Reason: $($payload.exactLikenessRouterChoice.reason)"
}
if ($payload.recommendedNextAction) {
  Write-Host "Recommended next action: $($payload.recommendedNextAction)"
}
if ($payload.warning) {
  Write-Host "Warning: $($payload.warning)"
}
