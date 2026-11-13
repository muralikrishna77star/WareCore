# Measures the numbered steps in the user-guide deck with PowerPoint's own
# text layout (Windows + PowerPoint only) and prints where each one should
# go, as JSON. Opens the deck read-only and never saves it, so nothing
# PowerPoint would add on save (such as a sensitivity label) reaches the file;
# build-user-guide.mjs applies the positions itself.
#
# Usage: powershell -File scripts/help/measure-steps.ps1 -Pptx <deck.pptx>
param([Parameter(Mandatory)][string]$Pptx)
$ErrorActionPreference = 'Stop'
$gap = 9          # points between steps
$afterSummary = 16
$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open((Resolve-Path $Pptx).Path, $true, $false, $false)
$out = New-Object System.Collections.ArrayList
foreach ($slide in $pres.Slides) {
  $byName = @{}
  foreach ($sh in $slide.Shapes) { $byName[$sh.Name] = $sh }
  if (-not $byName.ContainsKey('stepText-1')) { continue }
  $y = $byName['stepText-1'].Top
  if ($byName.ContainsKey('summary')) {
    $sum = $byName['summary']
    $h = $sum.TextFrame.TextRange.BoundHeight
    [void]$out.Add(@{ slide = $slide.SlideIndex; name = 'summary'; top = $sum.Top; height = $h })
    $y = $sum.Top + $h + $afterSummary
  }
  for ($i = 1; $byName.ContainsKey("stepText-$i"); $i++) {
    $t = $byName["stepText-$i"]
    $h = $t.TextFrame.TextRange.BoundHeight
    [void]$out.Add(@{ slide = $slide.SlideIndex; name = "stepText-$i"; top = $y; height = $h })
    $dotH = 0
    if ($byName.ContainsKey("stepDot-$i")) {
      $d = $byName["stepDot-$i"]
      $dotH = $d.Height
      $line = $t.TextFrame.TextRange.Lines(1).BoundHeight
      [void]$out.Add(@{ slide = $slide.SlideIndex; name = "stepDot-$i"; top = $y + ($line - $d.Height) / 2; height = $d.Height })
    }
    $y += [Math]::Max($h, $dotH) + $gap
  }
}
$pres.Close(); $app.Quit()
ConvertTo-Json -InputObject @($out) -Compress
