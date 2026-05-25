param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,

  [string]$UserId = ""
)

$ErrorActionPreference = "Stop"

$base = $ApiBaseUrl.TrimEnd("/")
$uri = "$base/api/diagnostics/repair-seedance-video-reference-status"
$body = @{}
if ($UserId.Trim()) {
  $body.userId = $UserId.Trim()
}

Write-Host "Repairing local Seedance video-reference status memory..."
Write-Host "Provider call: False"

try {
  $response = Invoke-WebRequest -Method Post -Uri $uri -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 8) -UseBasicParsing
  $payload = $response.Content | ConvertFrom-Json
} catch {
  $statusCode = $null
  $errorBody = $null
  if ($_.Exception.Response) {
    $statusCode = [int]$_.Exception.Response.StatusCode
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $errorBody = $reader.ReadToEnd()
    } catch {
      $errorBody = $null
    }
  }
  Write-Host "Repair failed."
  if ($statusCode) { Write-Host "Status code: $statusCode" }
  if ($errorBody) { Write-Host "Body: $errorBody" }
  throw
}

Write-Host "Repaired: $($payload.repaired)"
Write-Host "Canary job id: $($payload.canaryJobId)"
Write-Host "Canary status: $($payload.canaryStatus)"
Write-Host "Route status: $($payload.status)"
Write-Host "Failure category: $($payload.failureCategory)"
Write-Host "Verification video present: $($payload.verificationVideoPresent)"
Write-Host "Normalized asset used: $($payload.normalizedAssetUsed)"
Write-Host "Recommended next action: $($payload.recommendedNextAction)"
