param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [string]$UserId = "",
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

function Join-ApiUrl {
  param([string]$Base, [string]$Path)
  return ($Base.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

$path = "/api/diagnostics/repair-kling-canary-status"
$url = Join-ApiUrl $ApiBaseUrl $path
$body = @{}
if (-not [string]::IsNullOrWhiteSpace($UserId)) { $body.userId = $UserId }

Write-Host "Repairing local Kling canary billing status memory..."
Write-Host "API: $ApiBaseUrl"
Write-Host "Route: $path"
Write-Host "No provider calls are made by this repair."

try {
  $result = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6) -TimeoutSec $TimeoutSeconds
} catch {
  $statusCode = $null
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
    $statusCode = [int]$_.Exception.Response.StatusCode
  }
  Write-Host "Request failed."
  if ($statusCode) { Write-Host "status code: $statusCode" }
  if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message } else { Write-Host $_.Exception.Message }
  exit 1
}

Write-Host "ok: $($result.ok)"
Write-Host "scanned count: $($result.scannedCount)"
Write-Host "repaired count: $($result.repairedCount)"
Write-Host "provider calls made: $($result.providerCallsMade)"
if ($result.failureCategory) { Write-Host "failure category: $($result.failureCategory)" }
if ($result.recommendedNextAction) { Write-Host "recommended next action: $($result.recommendedNextAction)" }
