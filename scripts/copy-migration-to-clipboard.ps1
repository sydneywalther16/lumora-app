param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('character-profiles', 'memory-engine', 'scene-executor', 'feed-drafts', 'profile-characters', 'moderation-orchestrator', 'creator-experience', 'async-render-jobs', 'render-rate-limits', 'render-reliability')]
  [string] $Migration
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationFiles = @{
  'character-profiles' = 'backend/supabase/migrations/20260512_character_profiles_schema_repair.sql'
  'memory-engine' = 'backend/supabase/migrations/20260511_memory_engine.sql'
  'scene-executor' = 'backend/supabase/migrations/20260511_scene_executor_clip_metadata.sql'
  'feed-drafts' = 'backend/supabase/migrations/20260512_feed_drafts_thumbnails.sql'
  'profile-characters' = 'backend/supabase/migrations/20260512_profile_characters_ui.sql'
  'moderation-orchestrator' = 'backend/supabase/migrations/20260513_moderation_orchestrator.sql'
  'creator-experience' = 'backend/supabase/migrations/20260515_creator_experience_events.sql'
  'async-render-jobs' = 'backend/supabase/migrations/20260516_async_render_jobs.sql'
  'render-rate-limits' = 'backend/supabase/migrations/20260516_render_rate_limits.sql'
  'render-reliability' = 'backend/supabase/migrations/20260518_render_reliability_memory.sql'
}

$migrationPath = Join-Path $repoRoot $migrationFiles[$Migration]

if (-not (Test-Path -LiteralPath $migrationPath)) {
  throw "Migration file not found: $migrationPath"
}

$sql = Get-Content -LiteralPath $migrationPath -Raw
Set-Clipboard -Value $sql
Write-Host "SQL copied. Paste into Supabase SQL Editor and click Run."
