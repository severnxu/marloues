# Rebrand neobot -> marloues in a set of files (in-place).
# Usage: .\scripts\rebrand-neobot-to-marloues.ps1 -Path <file-or-dir> [-Filter *.ts,*.tsx,*.css]
# Replaces every case variant of the neobot brand token with the marloues equivalent:
#   NeoBot -> Marloues, NEOBOT -> MARLOUES, Neobot -> Marloues, neobot -> marloues
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string[]]$Filter = @("*.ts", "*.tsx", "*.css", "*.html", "*.json")
)

function Rebrand-File([string]$file) {
  $content = [System.IO.File]::ReadAllText($file)
  # Order matters: replace longer/pascal/camel variants before the bare lowercase one.
  $replaced = $content
  $replaced = $replaced -creplace 'NeoBot', 'Marloues'
  $replaced = $replaced -creplace 'neoBot', 'marloues'
  $replaced = $replaced -creplace 'NEOBOT', 'MARLOUES'
  $replaced = $replaced -creplace 'Neobot', 'Marloues'
  $replaced = $replaced -creplace 'neobot', 'marloues'
  if ($replaced -cne $content) {
    [System.IO.File]::WriteAllText($file, $replaced)
    return $true
  }
  return $false
}

$targets = if (Test-Path -PathType Container $Path) {
  Get-ChildItem -Path $Path -Recurse -File -Include $Filter
} else {
  @(Get-Item $Path)
}

$changed = 0
foreach ($t in $targets) {
  if (Rebrand-File $t.FullName) { $changed++; Write-Host "rebranded: $($t.FullName)" }
}
Write-Host "Done. $changed / $($targets.Count) files changed."
