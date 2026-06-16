# Generate icon.png from icon.ico for Linux build
# Linux AppImage requires at least 256x256 PNG icon

Add-Type -AssemblyName System.Drawing

$icoPath = Join-Path $PSScriptRoot "..\icon.ico"
$pngPath = Join-Path $PSScriptRoot "..\icon.png"

Write-Host "Converting icon.ico to icon.png..."

try {
    # Load ICO file
    $ico = [System.Drawing.Icon]::New($icoPath)
    $bitmap = $ico.ToBitmap()

    Write-Host "Original size: $($bitmap.Width)x$($bitmap.Height)"

    # Resize to 512x512 if smaller
    if ($bitmap.Width -lt 512 -or $bitmap.Height -lt 512) {
        Write-Host "Resizing to 512x512..."
        $newBitmap = New-Object System.Drawing.Bitmap(512, 512)
        $graphics = [System.Drawing.Graphics]::FromImage($newBitmap)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($bitmap, 0, 0, 512, 512)
        $bitmap.Dispose()
        $bitmap = $newBitmap
        $graphics.Dispose()
    }

    # Save as PNG
    $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

    Write-Host "Success! icon.png created"
    Write-Host "Path: $pngPath"
    Write-Host "Size: $($bitmap.Width)x$($bitmap.Height)"

    $bitmap.Dispose()
    $ico.Dispose()
} catch {
    Write-Error "Failed to generate icon: $_"
    exit 1
}