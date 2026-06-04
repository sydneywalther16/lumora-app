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
  $safe = $safe -replace '\b(?:fal|sk|rk|sbp|supabase)_[A-Za-z0-9._-]{12,}\b', '[redacted-key]'
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
        error = "scene_anchor_storage_status_http_error"
        message = Redact-StatusText $JsonText
        httpStatus = $HttpStatus
        secretsRedacted = $true
        privateUrlsRedacted = $true
      }
    }
  }
  return [PSCustomObject]@{
    ok = $false
    error = "scene_anchor_storage_status_http_error"
    message = Redact-StatusText $Message
    httpStatus = $HttpStatus
    secretsRedacted = $true
    privateUrlsRedacted = $true
  }
}

$url = Join-UrlPath -Base $AppBaseUrl -Path "/api/lumora/scene-anchor-storage-runtime-status"

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

Write-Host "Create runtime scene-anchor storage status"
if ($null -ne $httpStatus) { Write-Host "http status: $httpStatus" }
if ($null -ne $status.ok) { Write-Host "ok: $($status.ok)" }
Write-Host "endpoint loaded: $($status.endpointLoaded)"
Write-Host "storage adapter module loaded: $($status.storageAdapterModuleLoaded)"
Write-Host "supabase module loadable: $($status.supabaseModuleLoadable)"
Write-Host "supabase url present: $($status.supabaseUrlPresent)"
Write-Host "supabase service role key present: $($status.supabaseServiceRoleKeyPresent)"
Write-Host "bucket name: $($status.bucketName)"
Write-Host "configured: $($status.configured)"
Print-List -Label "missing config" -Values $status.missingConfig
Write-Host "secrets redacted: $($status.secretsRedacted)"
Write-Host "private URLs redacted: $($status.privateUrlsRedacted)"
if ($status.message) { Write-Host "message: $(Redact-StatusText $status.message)" }

if ($status.ok -eq $false) {
  if ($httpStatus -ge 500) {
    Write-Host "The storage runtime endpoint returned an HTTP server error, but the script handled it safely."
  }
  exit 0
}
