<#  Student Report Studio — one-time cloud configuration (Windows PowerShell)
    Publishes cloud-config.json to the website repository so every computer
    that opens the site configures itself automatically.

    Usage:  right-click -> "Run with PowerShell", or:
            powershell -ExecutionPolicy Bypass -File .\deploy.ps1

    Only PUBLIC values go into cloud-config.json (Supabase URL + anon key and
    the GitHub data repository). The GitHub token is used to commit the file
    and is NEVER written into it.
#>
param(
  [string]$SupabaseUrl = '',
  [string]$SupabaseAnon = '',
  [string]$WebsiteRepo = 'Petgabs/Peter-app2.com',
  [string]$DataRepo = 'Petgabs/report-data',
  [string]$Branch = 'main',
  [string]$Token = ''
)

function Read-Value($prompt, $default) {
  if ($default) { $v = Read-Host "$prompt [$default]" ; if (-not $v) { return $default } ; return $v }
  do { $v = Read-Host $prompt } while (-not $v) ; return $v
}

if (-not $SupabaseUrl)  { $SupabaseUrl  = Read-Value 'Supabase project URL (https://xxxx.supabase.co)' '' }
if (-not $SupabaseAnon) { $SupabaseAnon = Read-Value 'Supabase anon public key' '' }
if (-not $Token)        { $Token        = Read-Host 'GitHub token (Contents: Read and write on the website repository)' }
if (-not $Token) { Write-Error 'A GitHub token is required to publish cloud-config.json.' ; exit 1 }

$config = [ordered]@{
  version       = 1
  supabaseUrl   = $SupabaseUrl.TrimEnd('/')
  supabaseAnon  = $SupabaseAnon
  githubRepo    = $DataRepo
  githubBranch  = $Branch
  websiteRepo   = $WebsiteRepo
}
$json = ($config | ConvertTo-Json) + "`n"
Set-Content -Path (Join-Path $PSScriptRoot 'cloud-config.json') -Value $json -Encoding UTF8 -NoNewline
Write-Host "Wrote cloud-config.json:" -ForegroundColor Green
Write-Host $json

$api = "https://api.github.com/repos/$WebsiteRepo/contents/cloud-config.json"
$headers = @{
  Authorization          = "Bearer $Token"
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
}
$sha = $null
try {
  $existing = Invoke-RestMethod -Uri $api -Headers $headers -Method Get
  $sha = $existing.sha
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
}

$body = @{
  message = 'Set up cloud-config.json for Report Studio'
  content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
  branch  = 'main'
}
if ($sha) { $body.sha = $sha }
$payload = $body | ConvertTo-Json -Depth 5
$result = Invoke-RestMethod -Uri $api -Headers ($headers + @{ 'Content-Type' = 'application/json' }) -Method Put -Body $payload
Write-Host ""
Write-Host "Published cloud-config.json to $WebsiteRepo (commit $($result.commit.sha.Substring(0,7)))." -ForegroundColor Green
Write-Host "Open the website; it will connect itself on first load." -ForegroundColor Green
