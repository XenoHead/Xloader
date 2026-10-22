param(
	[int[]]$Sizes = @(16, 32, 48, 128),
	[string]$OutDir = "$PSScriptRoot\..\icons"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $OutDir)) {
	New-Item -ItemType Directory -Path $OutDir | Out-Null
}

function New-RoundedPath {
	param([single]$X, [single]$Y, [single]$W, [single]$H, [single]$R)

	$path = New-Object System.Drawing.Drawing2D.GraphicsPath
	$diameter = $R * 2
	$path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
	$path.AddArc($X + $W - $diameter, $Y, $diameter, $diameter, 270, 90)
	$path.AddArc($X + $W - $diameter, $Y + $H - $diameter, $diameter, $diameter, 0, 90)
	$path.AddArc($X, $Y + $H - $diameter, $diameter, $diameter, 90, 90)
	$path.CloseFigure()
	return $path
}

foreach ($size in $Sizes) {
	$bitmap = New-Object System.Drawing.Bitmap($size, $size)
	$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
	$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
	$graphics.Clear([System.Drawing.Color]::Transparent)

	$shape = New-RoundedPath -X 0 -Y 0 -W $size -H $size -R ($size * 0.22)
	$fill = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
		[System.Drawing.PointF]::new(0, 0),
		[System.Drawing.PointF]::new($size, $size),
		[System.Drawing.Color]::FromArgb(255, 44, 84, 150),
		[System.Drawing.Color]::FromArgb(255, 10, 16, 30)
	)
	$graphics.FillPath($fill, $shape)

	$edge = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(150, 120, 170, 235)), ([single]($size * 0.035))
	$graphics.DrawPath($edge, $shape)

	$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 125, 211, 252)), ([single]($size * 0.135))
	$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
	$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
	$graphics.DrawLine($pen, $size * 0.30, $size * 0.30, $size * 0.70, $size * 0.70)
	$graphics.DrawLine($pen, $size * 0.70, $size * 0.30, $size * 0.30, $size * 0.70)

	$target = Join-Path $OutDir "icon$size.png"
	$bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)

	$pen.Dispose()
	$edge.Dispose()
	$fill.Dispose()
	$shape.Dispose()
	$graphics.Dispose()
	$bitmap.Dispose()

	Write-Output "wrote $target"
}
