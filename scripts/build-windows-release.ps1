param(
    [string]$Version = "",
    [switch]$SkipBuild,
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

if ([string]::IsNullOrWhiteSpace($Version)) {
    $pkg = Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
    $Version = [string]$pkg.version
}
$Version = $Version.TrimStart("v")
$Tag = "v$Version"

Write-Host "==> Building NusaCBT Windows Release $Tag" -ForegroundColor Cyan

$DistRoot = Join-Path $RepoRoot "dist"
$PortableStage = Join-Path $DistRoot "portable"
$ReleaseDir = Join-Path $DistRoot "release"
$AppStage = Join-Path $PortableStage "app"
$RuntimeStage = Join-Path $PortableStage "runtime"

if (Test-Path $PortableStage) { Remove-Item $PortableStage -Recurse -Force }
if (Test-Path $ReleaseDir) { Remove-Item $ReleaseDir -Recurse -Force }
New-Item -ItemType Directory -Path $AppStage -Force | Out-Null
New-Item -ItemType Directory -Path $RuntimeStage -Force | Out-Null
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

# 1. Build Next.js standalone
if (-not $SkipBuild) {
    $env:NUSACBT_STANDALONE = "1"
    $env:NEXT_PUBLIC_APP_VERSION = $Version
    if (-not $env:NEXT_PUBLIC_APP_BUILD_DATE) {
        $env:NEXT_PUBLIC_APP_BUILD_DATE = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
    if (-not $env:NEXT_PUBLIC_APP_BUILD_SHA) {
        try {
            $sha = (git rev-parse --short=7 HEAD 2>$null)
            if ($sha) { $env:NEXT_PUBLIC_APP_BUILD_SHA = $sha.Trim() }
        } catch {}
    }

    Write-Host "==> Running npm run build (standalone)..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build gagal dengan kode $LASTEXITCODE" }
}

$StandaloneDir = Join-Path $RepoRoot ".next\standalone"
if (-not (Test-Path (Join-Path $StandaloneDir "server.js"))) {
    throw "Output standalone (.next\standalone\server.js) tidak ditemukan. Pastikan NUSACBT_STANDALONE=1."
}

# 2. Salin bundle standalone + static + public + migrations + skrip launcher CLI
Write-Host "==> Staging app payload..." -ForegroundColor Cyan
Copy-Item (Join-Path $StandaloneDir "*") $AppStage -Recurse -Force
Get-ChildItem $AppStage -Filter ".git*" -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Get-ChildItem $AppStage -Filter ".env*" -Force -ErrorAction SilentlyContinue | Remove-Item -Force

$NextServerRuntimeSrc = Join-Path $RepoRoot "node_modules\next\dist\compiled\next-server"
$NextServerRuntimeDest = Join-Path $AppStage "node_modules\next\dist\compiled\next-server"
if (Test-Path $NextServerRuntimeSrc) {
    New-Item -ItemType Directory -Path $NextServerRuntimeDest -Force | Out-Null
    Copy-Item (Join-Path $NextServerRuntimeSrc "*.runtime.prod.js") $NextServerRuntimeDest -Force
}

$StaticDest = Join-Path $AppStage ".next\static"
New-Item -ItemType Directory -Path $StaticDest -Force | Out-Null
Copy-Item (Join-Path $RepoRoot ".next\static\*") $StaticDest -Recurse -Force

$PublicDest = Join-Path $AppStage "public"
New-Item -ItemType Directory -Path $PublicDest -Force | Out-Null
Copy-Item (Join-Path $RepoRoot "public\*") $PublicDest -Recurse -Force

$MigrationsDest = Join-Path $AppStage "migrations"
New-Item -ItemType Directory -Path $MigrationsDest -Force | Out-Null
Copy-Item (Join-Path $RepoRoot "migrations\*") $MigrationsDest -Recurse -Force

Copy-Item (Join-Path $RepoRoot "scripts\server-entry.mjs") (Join-Path $AppStage "server-entry.mjs") -Force

$ScriptsDest = Join-Path $AppStage "scripts"
New-Item -ItemType Directory -Path $ScriptsDest -Force | Out-Null
Copy-Item (Join-Path $RepoRoot "scripts\launcher-cli.mjs") $ScriptsDest -Force
Copy-Item (Join-Path $RepoRoot "scripts\migration-encoding.mjs") $ScriptsDest -Force

$LibDest = Join-Path $AppStage "src\lib"
New-Item -ItemType Directory -Path $LibDest -Force | Out-Null
Copy-Item (Join-Path $RepoRoot "src\lib\admin-username.mjs") $LibDest -Force
Copy-Item (Join-Path $RepoRoot "src\lib\participant-password-constants.mjs") $LibDest -Force
Copy-Item (Join-Path $RepoRoot "src\lib\participant-password-crypto.mjs") $LibDest -Force
Copy-Item (Join-Path $RepoRoot "src\lib\password.mjs") $LibDest -Force
Copy-Item (Join-Path $RepoRoot "src\lib\postgres-config.mjs") $LibDest -Force

# 3. Bundel runtime Node.js portable
$NodeCmd = Get-Command node -ErrorAction Stop
Write-Host "==> Bundling Node runtime from $($NodeCmd.Source)" -ForegroundColor Cyan
Copy-Item $NodeCmd.Source (Join-Path $RuntimeStage "node.exe") -Force

# 4. Publish NusaCBT-Server.exe (self-contained win-x64 single file)
Write-Host "==> Building NusaCBT-Server.exe (.NET 8 win-x64)..." -ForegroundColor Cyan
$DotnetPublishDir = Join-Path $DistRoot "dotnet-publish"
if (Test-Path $DotnetPublishDir) { Remove-Item $DotnetPublishDir -Recurse -Force }

$BaseSemVer = ($Version -split "-")[0]
dotnet publish (Join-Path $RepoRoot "desktop\NusaCBT.Server\NusaCBT.Server.csproj") `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -p:Version=$Version `
    -p:AssemblyVersion="$BaseSemVer.0" `
    -p:FileVersion="$BaseSemVer.0" `
    -o $DotnetPublishDir

if ($LASTEXITCODE -ne 0) { throw "dotnet publish gagal dengan kode $LASTEXITCODE" }
Copy-Item (Join-Path $DotnetPublishDir "NusaCBT-Server.exe") (Join-Path $PortableStage "NusaCBT-Server.exe") -Force

# 5. Buat Portable ZIP
$PortableZipPath = Join-Path $ReleaseDir "NusaCBT-$Tag-win64-portable.zip"
Write-Host "==> Creating $PortableZipPath..." -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $PortableStage "*") -DestinationPath $PortableZipPath -CompressionLevel Optimal -Force

# 6. Buat Installer Inno Setup (jika iscc tersedia dan tidak di-skip)
if (-not $SkipInstaller) {
    $IsccPath = $null
    $CmdIscc = Get-Command iscc -ErrorAction SilentlyContinue
    if ($CmdIscc) {
        $IsccPath = $CmdIscc.Source
    } else {
        $DefaultIscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
        if (Test-Path $DefaultIscc) { $IsccPath = $DefaultIscc }
    }

    if ($IsccPath) {
        Write-Host "==> Compiling Inno Setup installer via $IsccPath..." -ForegroundColor Cyan
        & $IsccPath "/DAppVersion=$Version" "/DSourceDir=$PortableStage" "/DOutputDir=$ReleaseDir" (Join-Path $RepoRoot "installer\NusaCBT.iss")
        if ($LASTEXITCODE -ne 0) { throw "Inno Setup ISCC gagal dengan kode $LASTEXITCODE" }
    } else {
        Write-Warning "ISCC.exe (Inno Setup 6) tidak ditemukan. Melewati build installer .exe; hanya portable ZIP yang dibuat."
    }
}

# 7. Hitung SHA256SUMS.txt
Write-Host "==> Generating SHA256SUMS.txt..." -ForegroundColor Cyan
$SumLines = @()
Get-ChildItem $ReleaseDir -File | Sort-Object Name | ForEach-Object {
    if ($_.Name -ne "SHA256SUMS.txt") {
        $Hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $SumLines += "$Hash  $($_.Name)"
    }
}
Set-Content -Path (Join-Path $ReleaseDir "SHA256SUMS.txt") -Value $SumLines -Encoding Ascii

Write-Host "==> Selesai! Artefak rilis tersedia di $ReleaseDir" -ForegroundColor Green
Get-ChildItem $ReleaseDir | Format-Table Name, Length
