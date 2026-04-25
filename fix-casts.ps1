$files = @(
  "src\app\(app)\admin\page.tsx",
  "src\app\(app)\bills\page.tsx",
  "src\app\(app)\dashboard\page.tsx",
  "src\app\(app)\dispatch\page.tsx",
  "src\app\(app)\jobwork\page.tsx",
  "src\app\(app)\movements\page.tsx",
  "src\app\(app)\transfers\page.tsx"
)
foreach ($file in $files) {
  $full = Join-Path "C:\Projects\warecore" $file
  $content = Get-Content $full -Raw
  $newContent = $content -replace ' as \{ ', ' as unknown as { '
  Set-Content $full $newContent -NoNewline
  Write-Host "Fixed: $file"
}
Write-Host "All done"
