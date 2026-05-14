param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('character-profiles', 'memory-engine', 'scene-executor', 'feed-drafts')]
  [string] $Migration
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationFiles = @{
  'character-profiles' = 'backend/supabase/migrations/20260512_character_profiles_schema_repair.sql'
  'memory-engine' = 'backend/supabase/migrations/20260511_memory_engine.sql'
  'scene-executor' = 'backend/supabase/migrations/20260511_scene_executor_clip_metadata.sql'
  'feed-drafts' = 'backend/supabase/migrations/20260512_feed_drafts_thumbnails.sql'
}

$migrationPath = Join-Path $repoRoot $migrationFiles[$Migration]

if (-not (Test-Path -LiteralPath $migrationPath)) {
  throw "Migration file not found: $migrationPath"
}

$sql = Get-Content -LiteralPath $migrationPath -Raw
Set-Clipboard -Value $sql
Write-Host "SQL copied. Paste into Supabase SQL Editor and click Run."
