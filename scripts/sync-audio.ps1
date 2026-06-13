param(
  [string]$SourceDir = "G:\Codex\Korean_Espanol_Practice_Audio\source.mp3",
  [string]$MirrorDir = "G:\Codex\Korean_Espanol_Practice_Audio\public.ogg",
  [string]$FfmpegPath = "G:\Codex\tools\ffmpeg\ffmpeg-8.1.1-essentials_build\bin\ffmpeg.exe",
  [string]$Language = "Mexican Spanish"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PublicAudioDir = Join-Path $RepoRoot "audio\public"
$ContentDir = Join-Path $RepoRoot "content"
$ExpressionsPath = Join-Path $ContentDir "expressions.json"
$ManifestPath = Join-Path $ContentDir "audio_manifest.csv"

if (-not (Test-Path -LiteralPath $SourceDir)) {
  throw "Source directory not found: $SourceDir"
}

if (-not (Test-Path -LiteralPath $FfmpegPath)) {
  throw "ffmpeg not found: $FfmpegPath"
}

New-Item -ItemType Directory -Force -Path $PublicAudioDir | Out-Null
New-Item -ItemType Directory -Force -Path $MirrorDir | Out-Null
New-Item -ItemType Directory -Force -Path $ContentDir | Out-Null

Get-ChildItem -LiteralPath $PublicAudioDir -Filter "exp_*.ogg" -File | Remove-Item -Force
Get-ChildItem -LiteralPath $MirrorDir -Filter "exp_*.ogg" -File | Remove-Item -Force

function ConvertTo-CsvField {
  param([string]$Value)
  if ($null -eq $Value) {
    return ""
  }
  if ($Value -match '[,"\r\n]') {
    return '"' + ($Value -replace '"', '""') + '"'
  }
  return $Value
}

function Remove-TrailingPromptDash {
  param([string]$Value)
  if ($null -eq $Value) {
    return ""
  }
  return ($Value.Trim() -replace '\s*[-–—]+\s*$', '')
}

$files = Get-ChildItem -LiteralPath $SourceDir -Filter "*.mp3" -File | Sort-Object Name
if ($files.Count -eq 0) {
  throw "No MP3 files found in $SourceDir"
}

$expressions = @()
$manifestRows = New-Object System.Collections.Generic.List[string]
$manifestRows.Add("id,type,language,ko,foreign,source_file,public_file")

$index = 1
foreach ($file in $files) {
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
  $parts = $baseName -split "_", 3
  if ($parts.Count -lt 3) {
    throw "Expected filename format K00000_Korean_Russian.mp3, got: $($file.Name)"
  }

  $id = "exp_{0:D6}" -f $index
  $ko = Remove-TrailingPromptDash $parts[1]
  $foreign = Remove-TrailingPromptDash $parts[2]
  $publicFile = "audio/public/$id.ogg"
  $repoOut = Join-Path $PublicAudioDir "$id.ogg"
  $mirrorOut = Join-Path $MirrorDir "$id.ogg"

  & $FfmpegPath -y -i $file.FullName -vn -map_metadata -1 -c:a libopus -b:a 48k $repoOut
  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed for $($file.FullName)"
  }

  Copy-Item -LiteralPath $repoOut -Destination $mirrorOut -Force

  $expressions += [ordered]@{
    id = $id
    ko = $ko
    foreign = $foreign
    language = $Language
    audio = $publicFile
  }

  $manifestRows.Add((@(
    $id,
    "expression",
    $Language,
    $ko,
    $foreign,
    $file.Name,
    $publicFile
  ) | ForEach-Object { ConvertTo-CsvField $_ }) -join ",")

  $index += 1
}

$json = [ordered]@{ expressions = $expressions } | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($ExpressionsPath, $json, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllLines($ManifestPath, $manifestRows, [System.Text.UTF8Encoding]::new($false))

Write-Host "Synced $($files.Count) audio files."
Write-Host "Expressions: $ExpressionsPath"
Write-Host "Manifest: $ManifestPath"

