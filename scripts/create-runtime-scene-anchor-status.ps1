param(
  [Parameter(Mandatory = $true)]
  [string]$AppBaseUrl
)

$ErrorActionPreference = "Stop"

function Join-UrlPath {
  param(
    [string]$Base,
    [string]$Path
  )
  return $Base.TrimEnd("/") + "/" + $Path.TrimStart("/")
}

function Print-List {
  param(
    [string]$Label,
    $Values
  )
  if ($Values -and $Values.Count -gt 0) {
    Write-Host ("{0}: {1}" -f $Label, ($Values -join ', '))
  } else {
    Write-Host ("{0}: none" -f $Label)
  }
}

function Redact-StatusText {
  param([string]$Text)
  if (-not $Text) { return "" }
  $safe = $Text -replace 'https?://\S+', '[redacted-url]'
  $safe = $safe -replace '(?i)(Key|Bearer)\s+[A-Za-z0-9._:-]{12,}', '[redacted-auth]'
  $safe = $safe -replace '[A-Za-z0-9_-]{16,}:[A-Za-z0-9._:-]{16,}', '[redacted-key]'
  return $safe
}

function Convert-JsonOrFallback {
  param(
    [string]$JsonText,
    [int]$HttpStatus,
    [string]$Message
  )
  if ($JsonText) {
    try {
      return $JsonText | ConvertFrom-Json
    } catch {
      return [PSCustomObject]@{
        ok = $false
        error = "runtime_status_http_error"
        message = Redact-StatusText $JsonText
        httpStatus = $HttpStatus
        secretsRedacted = $true
      }
    }
  }
  return [PSCustomObject]@{
    ok = $false
    error = "runtime_status_http_error"
    message = Redact-StatusText $Message
    httpStatus = $HttpStatus
    secretsRedacted = $true
  }
}

$url = Join-UrlPath -Base $AppBaseUrl -Path "/api/lumora/scene-anchor-runtime-status"

$httpStatus = $null
try {
  $response = Invoke-WebRequest -Method Get -Uri $url -TimeoutSec 30 -UseBasicParsing
  $httpStatus = [int]$response.StatusCode
  $status = Convert-JsonOrFallback -JsonText $response.Content -HttpStatus $httpStatus -Message ""
} catch {
  $httpStatus = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  $bodyText = ""
  if ($_.Exception.Response) {
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $bodyText = $reader.ReadToEnd()
    } catch {
      $bodyText = ""
    }
  }
  $status = Convert-JsonOrFallback -JsonText $bodyText -HttpStatus $httpStatus -Message $_.Exception.Message
}

Write-Host "Create runtime scene-anchor status"
if ($null -ne $httpStatus) { Write-Host "http status: $httpStatus" }
if ($null -ne $status.ok) { Write-Host "ok: $($status.ok)" }
Write-Host "endpoint loaded: $($status.endpointLoaded)"
Write-Host "helper loaded: $($status.helperLoaded)"
Write-Host "runtime status built: $($status.runtimeStatusBuilt)"
if ($status.ok -eq $false) {
  Write-Host "error: $($status.error)"
  if ($status.message) { Write-Host "message: $(Redact-StatusText $status.message)" }
  Write-Host "secrets redacted: $($status.secretsRedacted)"
  if ($status.privateUrlsRedacted) { Write-Host "private URLs redacted: $($status.privateUrlsRedacted)" }
  if ($httpStatus -ge 500) {
    Write-Host "The Create runtime endpoint returned an HTTP server error, but the script handled it safely."
  }
  exit 0
}
Write-Host "runtime: $($status.runtime)"
Write-Host "scene anchor enabled: $($status.sceneAnchorEnabled)"
Write-Host "scene anchor configured: $($status.sceneAnchorConfigured)"
Write-Host "scene anchor implemented: $($status.sceneAnchorImplemented)"
Write-Host "provider: $($status.sceneAnchorProvider)"
Write-Host "model: $($status.sceneAnchorModel)"
Write-Host "fallback mode: $($status.sceneAnchorFallbackMode)"
Write-Host "fal key present: $($status.falKeyPresent)"
Write-Host "kling api key present: $($status.klingApiKeyPresent)"
Write-Host "scene-anchor fal credential present: $($status.sceneAnchorFalCredentialPresent)"
Write-Host "kling enabled: $($status.klingEnabled)"
Write-Host "kling provider: $($status.klingProvider)"
Write-Host "kling reference model: $($status.klingReferenceModel)"
Write-Host "kling scene-anchor video model: $($status.klingSceneAnchorVideoModel)"
Write-Host "kling scene-anchor video model configured: $($status.klingSceneAnchorVideoModelConfigured)"
Write-Host "enable render probe: $($status.enableRenderProbe)"
Write-Host "node env: $($status.nodeEnv)"
Print-List -Label "missing config" -Values $status.missingConfig
Write-Host "secrets redacted: $($status.secretsRedacted)"
Write-Host "private URLs redacted: $($status.privateUrlsRedacted)"

if (-not $status.sceneAnchorConfigured) {
  Write-Host "Render backend may be configured, but Vercel Create runtime is missing scene-anchor env vars."
}

if ($status.recommendedNextAction) {
  Write-Host "recommended next action: $($status.recommendedNextAction)"
}
