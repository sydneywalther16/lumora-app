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

Write-Host "Starting OpenAI/Sora self character canary..."
Write-Host "Endpoint: $base/api/diagnostics/sora-character-canary/self"
Write-Host "Warning: this may consume provider credits when enabled."

try {
  $response = Invoke-WebRequest `
    -Uri "$base/api/diagnostics/sora-character-canary/self" `
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
Write-Host "Model: $($payload.model)"
Write-Host "Raw REST available: $($payload.openaiRawRestAvailable)"
Write-Host "SDK videos available: $($payload.openaiSdkVideosAvailable)"
Write-Host "Character id present: $($payload.selfProviderCharacterIdPresent)"
Write-Host "Character creation supported: $($payload.characterCreationSupported)"
Write-Host "Character video usage mapped: $($payload.characterVideoUsageMapped)"
Write-Host "Status: $($payload.status)"
Write-Host "Output URL present: $($payload.output_url_present)"
Write-Host "Parsed video URL present: $($payload.parsed_video_url_present)"
if ($payload.failureCategory) { Write-Host "Failure category: $($payload.failureCategory)" }
if ($payload.route) {
  Write-Host "Selected route: $($payload.route.selectedCreateLikenessRoute)"
  Write-Host "Why chosen: $($payload.route.whyChosen)"
}
if ($payload.recommendedNextAction) {
  Write-Host "Recommended next action: $($payload.recommendedNextAction)"
}
if ($payload.warning) {
  Write-Host "Warning: $($payload.warning)"
}
