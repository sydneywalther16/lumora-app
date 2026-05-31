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

$url = Join-UrlPath -Base $AppBaseUrl -Path "/api/lumora/scene-anchor-runtime-status"

try {
  $status = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 30
} catch {
  Write-Error "Failed to read Create runtime scene-anchor status from $url. $($_.Exception.Message)"
  exit 1
}

Write-Host "Create runtime scene-anchor status"
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
Write-Host "kling reference model: $($status.klingReferenceModel)"
Write-Host "kling scene-anchor video model: $($status.klingSceneAnchorVideoModel)"
Write-Host "kling scene-anchor video model configured: $($status.klingSceneAnchorVideoModelConfigured)"
Write-Host "enable render probe: $($status.enableRenderProbe)"
Write-Host "node env: $($status.nodeEnv)"
Print-List -Label "missing config" -Values $status.missingConfig
Write-Host "private URLs redacted: $($status.privateUrlsRedacted)"

if (-not $status.sceneAnchorConfigured) {
  Write-Host "Render backend may be configured, but Vercel Create runtime is missing scene-anchor env vars."
}

if ($status.recommendedNextAction) {
  Write-Host "recommended next action: $($status.recommendedNextAction)"
}
