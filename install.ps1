# Installe Gitdrop (binaire autonome, sans Node.js) sous Windows :
#   irm https://github.com/djabliameizafredy-a11y/gitdrop/releases/latest/download/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$Repo = if ($env:GITDROP_REPO) { $env:GITDROP_REPO } else { 'djabliameizafredy-a11y/gitdrop' }
$Base = if ($env:GITDROP_BASE_URL) { $env:GITDROP_BASE_URL } else { "https://github.com/$Repo/releases/latest/download" }
$Dir  = if ($env:GITDROP_INSTALL_DIR) { $env:GITDROP_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\gitdrop' }

$arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { throw 'Windows 32 bits non supporté.' }
$asset = "gitdrop-windows-$arch.exe"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
  Write-Host "→ Téléchargement de $asset…"
  Invoke-WebRequest "$Base/$asset" -OutFile (Join-Path $tmp $asset)
  Invoke-WebRequest "$Base/$asset.sha256" -OutFile (Join-Path $tmp "$asset.sha256")

  $expected = (Get-Content (Join-Path $tmp "$asset.sha256")).Split(' ')[0].ToLower()
  $actual = (Get-FileHash (Join-Path $tmp $asset) -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { throw 'Somme de contrôle invalide : le téléchargement est corrompu ou altéré.' }

  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Copy-Item (Join-Path $tmp $asset) (Join-Path $Dir 'gitdrop.exe') -Force
  Write-Host "✔ Gitdrop installé dans $Dir\gitdrop.exe"

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (($userPath -split ';') -notcontains $Dir) {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$Dir", 'User')
    Write-Host '⚠ Dossier ajouté à votre PATH : ouvrez un nouveau terminal.'
  }
  Write-Host 'Essayez :  gitdrop login   puis   gitdrop push .\mon-projet'
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
