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
  # Collapse any number of repeated "as unknown" down to a single one
  $newContent = $content -replace '( as unknown)+( as \{)', ' as unknown$2'
  # Also fix array casts: (x) as Array<...> -> (x) as unknown as Array<...>
  $newContent = $newContent -replace '\) as Array<', ') as unknown as Array<'
  Set-Content $full $newContent -NoNewline
  Write-Host "Fixed: $file"
}
Write-Host "All done"
