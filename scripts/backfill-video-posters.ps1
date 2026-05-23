param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,

  [int]$Limit = 5,

  [switch]$OnlyLatest,

  [ValidateSet('generation_job', 'post', 'project', 'all')]
  [string]$EntityKind = 'all'
)

$ErrorActionPreference = 'Stop'

function Write-ReasonMap {
  param(
    [string]$Label,
    [object]$Map
  )

  Write-Host $Label
  if ($null -eq $Map) {
    Write-Host '  none'
    return
  }

  $properties = $Map.PSObject.Properties
  if ($properties.Count -eq 0) {
    Write-Host '  none'
    return
  }

  foreach ($property in $properties) {
    Write-Host ("  {0}: {1}" -f $property.Name, $property.Value)
  }
}

$base = $ApiBaseUrl.TrimEnd('/')
$uri = "$base/api/diagnostics/backfill-video-posters"
$body = @{
  limit = $Limit
  onlyLatest = [bool]$OnlyLatest
  entityKind = $EntityKind
} | ConvertTo-Json -Depth 4

try {
  $response = Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body $body
} catch {
  Write-Host "Backfill request failed."
  if ($_.Exception.Response) {
    Write-Host ("Status code: {0}" -f ([int]$_.Exception.Response.StatusCode))
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = [System.IO.StreamReader]::new($stream)
      $text = $reader.ReadToEnd()
      if ($text) { Write-Host $text }
    } catch {
      Write-Host $_.Exception.Message
    }
  } else {
    Write-Host $_.Exception.Message
  }
  exit 1
}

Write-Host "Video poster backfill"
Write-Host ("Run at: {0}" -f $response.runAt)
Write-Host ("Scanned: {0}" -f $response.scannedCount)
Write-Host ("Generated: {0}" -f $response.generatedCount)
Write-Host ("Skipped: {0}" -f $response.skippedCount)
Write-Host ("Failed: {0}" -f $response.failedCount)
Write-Host ("Poster generation available: {0}" -f $response.posterGenerationAvailable)
if ($response.availability) {
  Write-Host ("Poster bucket: {0} exists={1}" -f $response.availability.posterBucketName, $response.availability.posterBucketExists)
}

Write-ReasonMap -Label 'Skipped by reason:' -Map $response.skippedByReason
Write-ReasonMap -Label 'Failed by reason:' -Map $response.failedByReason

if ($response.firstFailures -and $response.firstFailures.Count -gt 0) {
  Write-Host 'First failures:'
  foreach ($failure in $response.firstFailures) {
    Write-Host ("  {0} {1} host={2} reason={3}" -f $failure.entityKind, $failure.id, $failure.videoHost, $failure.reason)
    if ($failure.error) {
      Write-Host ("    {0}" -f $failure.error)
    }
  }
}

if ($response.generatedCount -gt 0 -and $response.failedCount -eq 0) {
  Write-Host 'Posters generated. Run again with a higher limit if scanned equals the limit.'
} elseif ($response.skippedCount -gt 0 -and $response.failedCount -eq 0) {
  Write-Host 'Backfill completed with historical URLs skipped safely. Run again for more rows if needed.'
} elseif ($response.failedCount -gt 0) {
  Write-Host 'Backfill ran, but some rows need storage/video repair before posters can be generated.'
} else {
  Write-Host 'No eligible missing-poster videos were found.'
}
