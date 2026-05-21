param(
  [string]$ApiBaseUrl = "http://localhost:8787",
  [switch]$ResumeExpiredCooldown
)

$ErrorActionPreference = "Stop"

function Join-ApiUrl {
  param(
    [string]$Base,
    [string]$Path
  )
  return ($Base.TrimEnd("/") + "/" + $Path.TrimStart("/"))
}

function Read-JsonEndpoint {
  param([string]$Url)
  try {
    return Invoke-RestMethod -Method Get -Uri $Url -TimeoutSec 30
  } catch {
    Write-Host "Unable to read $Url"
    Write-Host $_.Exception.Message
    return $null
  }
}

$renderLastUrl = Join-ApiUrl $ApiBaseUrl "/api/diagnostics/render-last"
$healthUrl = Join-ApiUrl $ApiBaseUrl "/api/health/diagnostics"

$renderLast = Read-JsonEndpoint $renderLastUrl
$health = Read-JsonEndpoint $healthUrl

Write-Host "Lumora render success smoke"
Write-Host "API: $ApiBaseUrl"
Write-Host ""

if (-not $renderLast -or -not $renderLast.latestGenerationJob) {
  Write-Host "No latest generation job was found."
} else {
  $job = $renderLast.latestGenerationJob
  Write-Host ("Job: {0}" -f $job.id)
  Write-Host ("Status: {0}" -f $job.status)
  Write-Host ("Current attempt: {0}" -f $job.currentAttemptTier)
  Write-Host ("Provider prediction created: {0}" -f $job.providerPredictionIdExists)
  Write-Host ("Provider status: {0}" -f $job.providerStatus)
  Write-Host ("Paid attempts used: {0}/{1}" -f $job.paidAttemptsUsed, $job.paidAttemptBudget)
  Write-Host ("Output URL present: {0}" -f $job.outputUrlPresent)
  Write-Host ("Parsed video URL present: {0}" -f $job.parsedOutputUrlPresent)
  Write-Host ("Verified video: {0}" -f $job.hasVerifiedVideoOutput)
  Write-Host ("Next action: {0}" -f $job.nextResumeAction)

  if (-not $job.providerPredictionIdExists) {
    Write-Host "Summary: No provider prediction was created."
  } elseif ($job.hasVerifiedVideoOutput) {
    Write-Host "Summary: Video verified."
  } elseif ($job.status -eq "rate_limited") {
    Write-Host ("Summary: Rate limited until {0}." -f $job.cooldownUntil)
  } elseif ($job.providerStatus -eq "starting" -or $job.providerStatus -eq "processing") {
    Write-Host "Summary: Provider still processing."
  } elseif ($job.status -eq "completed" -and -not $job.parsedOutputUrlPresent) {
    Write-Host "Summary: Output missing."
  } elseif ($job.status -eq "paused" -or $job.status -eq "failed") {
    Write-Host "Summary: Paused after budget exhausted or no safe route remained."
  } else {
    Write-Host ("Summary: {0}" -f $job.whyNotCompleted)
  }

  if ($ResumeExpiredCooldown -and $job.status -eq "rate_limited" -and $job.cooldownExpired -and $job.id) {
    $resumeUrl = Join-ApiUrl $ApiBaseUrl ("/api/generations/jobs/{0}/resume" -f $job.id)
    Write-Host ""
    Write-Host "Cooldown expired. Calling resume endpoint..."
    try {
      $resume = Invoke-RestMethod -Method Post -Uri $resumeUrl -TimeoutSec 30
      Write-Host ("Resume status: {0}" -f $resume.status)
      Write-Host ("Resume message: {0}" -f $resume.progressLabel)
    } catch {
      Write-Host "Resume call failed."
      Write-Host $_.Exception.Message
    }
  }
}

Write-Host ""
if ($health -and $health.renderSuccessEngine) {
  Write-Host "Render Success Engine"
  Write-Host ("Enabled: {0}" -f $health.renderSuccessEngine.enabled)
  Write-Host ("Active masters: {0}" -f $health.renderSuccessEngine.activeMasters)
  Write-Host ("Current stuck jobs: {0}" -f $health.renderSuccessEngine.currentStuckJobs)
  Write-Host ("Duplicate renders prevented: {0}" -f $health.renderSuccessEngine.duplicateRenderPrevented)
  Write-Host ("Paid attempts prevented: {0}" -f $health.renderSuccessEngine.paidAttemptsPrevented)
}
