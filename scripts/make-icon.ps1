# Generates build/icon.png (256px) and build/icon.ico (multi-size, PNG-compressed).
# Ranch Ad Blocker: green shield with a "blocked" bar on a dark rounded square.
param([string]$OutDir = (Join-Path $PSScriptRoot '..\build'))
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function New-IconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = $size / 960.0

  # Dark rounded square, green shield, dark "blocked" bar. 960px grid.
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0x0b, 0x10, 0x0c))
  $rad = 200 * $k; $e = $size
  $sq = New-Object System.Drawing.Drawing2D.GraphicsPath
  $sq.AddArc(0, 0, 2 * $rad, 2 * $rad, 180, 90); $sq.AddArc($e - 2 * $rad, 0, 2 * $rad, 2 * $rad, 270, 90)
  $sq.AddArc($e - 2 * $rad, $e - 2 * $rad, 2 * $rad, 2 * $rad, 0, 90); $sq.AddArc(0, $e - 2 * $rad, 2 * $rad, 2 * $rad, 90, 90)
  $sq.CloseFigure(); $g.FillPath($bg, $sq)

  $green = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0x3d, 0xdc, 0x84))
  $sh = New-Object System.Drawing.Drawing2D.GraphicsPath
  $P = { param($x, $y) New-Object System.Drawing.PointF ([single]($x * $k)), ([single]($y * $k)) }
  $sh.AddLine((& $P 480 150), (& $P 770 255))
  $sh.AddBezier((& $P 770 255), (& $P 770 560), (& $P 660 730), (& $P 480 815))
  $sh.AddBezier((& $P 480 815), (& $P 300 730), (& $P 190 560), (& $P 190 255))
  $sh.CloseFigure(); $g.FillPath($green, $sh)

  $bar = New-Object System.Drawing.Drawing2D.GraphicsPath
  $bx = 320 * $k; $by = 435 * $k; $bw = 320 * $k; $bh = 90 * $k; $br = 45 * $k
  $bar.AddArc($bx, $by, 2 * $br, 2 * $br, 90, 180); $bar.AddArc($bx + $bw - 2 * $br, $by, 2 * $br, 2 * $br, 270, 180)
  $bar.CloseFigure(); $g.FillPath($bg, $bar)
  $g.Dispose()
  return $bmp
}

$sizes = 256, 64, 48, 32, 24, 16
$pngs = @{}
foreach ($sz in $sizes) {
  $bmp = New-IconBitmap $sz
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs[$sz] = $ms.ToArray()
  if ($sz -eq 256) { $bmp.Save((Join-Path $OutDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  $bmp.Dispose()
}

# ICO container: header + directory + PNG payloads
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
foreach ($sz in $sizes) {
  $dim = if ($sz -ge 256) { 0 } else { $sz }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]$pngs[$sz].Length); $w.Write([UInt32]$offset)
  $offset += $pngs[$sz].Length
}
foreach ($sz in $sizes) { $w.Write($pngs[$sz]) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $OutDir 'icon.ico'), $out.ToArray())
"Wrote icon.png and icon.ico to $OutDir"
