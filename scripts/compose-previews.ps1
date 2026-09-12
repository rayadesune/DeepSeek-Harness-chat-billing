# Compose the README preview images from one full-app capture:
#  - preview-detail.png : the panel close-up, with the today-ranking titles pixelated
#  - preview-overview.png: badge + panel over a fully pixelated app background
# Everything that is not the plugin UI is mosaicked; the plugin rects are pasted
# back from the untouched source pixels.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$OutDetail,
  [Parameter(Mandatory = $true)][string]$OutOverview
)

Add-Type -AssemblyName System.Drawing
$mosaic = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$nearest = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor

# Capture-local rects (capture origin is global (0,52)).
$panel = New-Object System.Drawing.Rectangle 1317, 91, 526, 492
$badge = New-Object System.Drawing.Rectangle 1606, 16, 230, 64

function New-Mosaic([System.Drawing.Bitmap]$bmp, [System.Drawing.Rectangle]$rect, [int]$cell) {
  $w = [Math]::Max(1, [int]($rect.Width / $cell))
  $h = [Math]::Max(1, [int]($rect.Height / $cell))
  $small = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($small)
  $g.InterpolationMode = $mosaic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), $rect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $small
}

function Set-Mosaic([System.Drawing.Bitmap]$bmp, [System.Drawing.Rectangle]$rect, [int]$cell) {
  $small = New-Mosaic $bmp $rect $cell
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = $nearest
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.DrawImage($small, $rect)
  $g.Dispose()
  $small.Dispose()
}

$src = [System.Drawing.Bitmap]::FromFile($Source)

# --- detail: panel crop, then mosaic the ranking's title column ---------------
$detailRect = New-Object System.Drawing.Rectangle 1309, 83, 542, 508
$detail = New-Object System.Drawing.Bitmap $detailRect.Width, $detailRect.Height
$g = [System.Drawing.Graphics]::FromImage($detail)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $detail.Width, $detail.Height), $detailRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()

# Detect the ranking title rows instead of assuming their geometry: scan the
# title column (left of the amounts) for bright text pixels and mosaic each band.
function Get-TextBands([System.Drawing.Bitmap]$bmp, [int]$x0, [int]$x1, [int]$y0, [int]$y1, [int]$minPixels) {
  $bands = New-Object System.Collections.ArrayList
  $inBand = $false
  $start = 0
  for ($y = $y0; $y -le $y1; $y++) {
    $count = 0
    for ($x = $x0; $x -le $x1; $x++) {
      $c = $bmp.GetPixel($x, $y)
      if (($c.R + $c.G + $c.B) -gt 240) { $count++ }
    }
    if ($count -ge $minPixels) {
      if (-not $inBand) { $start = $y; $inBand = $true }
    } elseif ($inBand) {
      [void]$bands.Add(@($start, ($y - 1)))
      $inBand = $false
    }
  }
  if ($inBand) { [void]$bands.Add(@($start, $y1)) }
  return $bands
}

$bands = Get-TextBands $detail 70 443 305 500 12
foreach ($band in $bands) {
  $top = [Math]::Max(0, $band[0] - 3)
  $height = [Math]::Min($detail.Height - $top, ($band[1] - $band[0]) + 7)
  Set-Mosaic $detail (New-Object System.Drawing.Rectangle 68, $top, 377, $height) 10
}
"mosaicked title bands: $($bands.Count)"
# The 8px margin around the panel is page background: pixelate it too, so no
# fragment of the conversation survives outside the plugin.
$ring = New-Object System.Drawing.Bitmap $detail.Width, $detail.Height
$g = [System.Drawing.Graphics]::FromImage($ring)
$g.DrawImage($detail, 0, 0, $detail.Width, $detail.Height)
$g.Dispose()
Set-Mosaic $ring (New-Object System.Drawing.Rectangle 0, 0, $ring.Width, $ring.Height) 8
$panelLocal = New-Object System.Drawing.Rectangle 8, 8, 526, 492
$g = [System.Drawing.Graphics]::FromImage($ring)
$g.DrawImage($detail, $panelLocal, $panelLocal, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$detail.Dispose()
$detail = $ring
$detail.Save($OutDetail, [System.Drawing.Imaging.ImageFormat]::Png)

# --- overview: mosaic the whole frame, paste back the badge and the ----------
# (already title-mosaicked) panel bitmap, then crop to badge + panel.
$full = New-Object System.Drawing.Bitmap $src.Width, $src.Height
$g = [System.Drawing.Graphics]::FromImage($full)
$g.DrawImage($src, 0, 0, $src.Width, $src.Height)
$g.Dispose()
Set-Mosaic $full (New-Object System.Drawing.Rectangle 0, 0, $full.Width, $full.Height) 14
$g = [System.Drawing.Graphics]::FromImage($full)
$g.DrawImage($detail, $detailRect, (New-Object System.Drawing.Rectangle 0, 0, $detail.Width, $detail.Height), [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawImage($src, $badge, $badge, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$overviewRect = New-Object System.Drawing.Rectangle 1200, 0, 720, 620
$overview = New-Object System.Drawing.Bitmap $overviewRect.Width, $overviewRect.Height
$g = [System.Drawing.Graphics]::FromImage($overview)
$g.DrawImage($full, (New-Object System.Drawing.Rectangle 0, 0, $overview.Width, $overview.Height), $overviewRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$overview.Save($OutOverview, [System.Drawing.Imaging.ImageFormat]::Png)
$overview.Dispose()
$detail.Dispose()

$src.Dispose()
$full.Dispose()
"detail  : $($detailRect.Width)x$($detailRect.Height) -> $OutDetail"
"overview: $($overviewRect.Width)x$($overviewRect.Height) -> $OutOverview"
