param([switch]$Remove, [string]$RefreshFile)
$ErrorActionPreference = 'Stop'

# An optional, current-user icon test. It never changes the .zip association
# or installs an application/open command. Run with -Remove to undo it.
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$iconPath = Join-Path $projectRoot 'icons/dashboard-project-shell.ico'
$progId = 'ProgramBoard.Project.Test.1'
$owner = [System.IO.Path]::GetFullPath($PSCommandPath)
$classes = 'Registry::HKEY_CURRENT_USER\Software\Classes'
$extensionKey = "$classes\.pboard"
$typeKey = "$classes\$progId"

if (-not ('ProgramBoardIconTest.Shell' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace ProgramBoardIconTest {
  public static class Shell {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr first, IntPtr second);
    [DllImport("shell32.dll", EntryPoint="SHChangeNotify", CharSet=CharSet.Unicode, ExactSpelling=true)]
    public static extern void NotifyPath(uint eventId, uint flags, string first, IntPtr second);
  }
}
'@
}

function Get-TestOwner([string]$key) {
  if (Test-Path -LiteralPath $key) { return (Get-Item -LiteralPath $key).GetValue('ProgramBoardTestOwner') }
  return $null
}

function Refresh-TestFile {
  if (-not $RefreshFile) { return }
  $file = [System.IO.Path]::GetFullPath($RefreshFile)
  if ([System.IO.Path]::GetExtension($file) -ine '.pboard' -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw 'RefreshFile must name an existing .pboard file.'
  }
  # Invalidate the actual item and folder view, not just the association cache.
  [ProgramBoardIconTest.Shell]::NotifyPath(0x00002000, 0x1005, $file, [IntPtr]::Zero)
  [ProgramBoardIconTest.Shell]::NotifyPath(0x00001000, 0x1005, [System.IO.Path]::GetDirectoryName($file), [IntPtr]::Zero)
  Write-Output "Refreshed the Windows file icon: $file"
}

if ($RefreshFile) {
  $refreshTarget = [System.IO.Path]::GetFullPath($RefreshFile)
  if ([System.IO.Path]::GetExtension($refreshTarget) -ine '.pboard' -or -not (Test-Path -LiteralPath $refreshTarget -PathType Leaf)) {
    throw 'RefreshFile must name an existing .pboard file.'
  }
}

if ($Remove) {
  # Remove only the exact keys created by this script, and refuse if another
  # application has changed their values or added its own registration data.
  foreach ($key in @($extensionKey, $typeKey)) {
    if ((Test-Path -LiteralPath $key) -and (Get-TestOwner $key) -ne $owner) {
      throw "This test no longer owns $key; nothing was removed."
    }
  }
  if (Test-Path -LiteralPath $extensionKey) {
    $extension = Get-Item -LiteralPath $extensionKey
    if ($extension.GetValue('') -ne $progId -or
        @($extension.GetSubKeyNames() | Where-Object { $_ -ne 'DefaultIcon' }).Count -or
        @($extension.GetValueNames() | Where-Object { $_ -notin @('', 'ProgramBoardTestOwner') }).Count) {
      throw 'The .pboard registration changed after the test; nothing was removed.'
    }
    $extensionIconKey = "$extensionKey\DefaultIcon"
    if ((Test-Path -LiteralPath $extensionIconKey) -and
        ((Get-Item -LiteralPath $extensionIconKey).GetValue('') -ne ('"' + $iconPath + '",0') -or
         (Get-Item -LiteralPath $extensionIconKey).SubKeyCount -ne 0 -or
         @((Get-Item -LiteralPath $extensionIconKey).GetValueNames() | Where-Object { $_ -ne '' }).Count)) {
      throw 'Another icon registration changed the .pboard type; nothing was removed.'
    }
  }
  if (Test-Path -LiteralPath $typeKey) {
    $type = Get-Item -LiteralPath $typeKey
    $iconKey = "$typeKey\DefaultIcon"
    if ($type.GetValue('') -ne 'Program Dashboard Project' -or
        @($type.GetSubKeyNames() | Where-Object { $_ -ne 'DefaultIcon' }).Count -or
        @($type.GetValueNames() | Where-Object { $_ -notin @('', 'ProgramBoardTestOwner') }).Count -or
        -not (Test-Path -LiteralPath $iconKey) -or
        (Get-Item -LiteralPath $iconKey).GetValue('') -ne ('"' + $iconPath + '",0') -or
        (Get-Item -LiteralPath $iconKey).SubKeyCount -ne 0 -or
        @((Get-Item -LiteralPath $iconKey).GetValueNames() | Where-Object { $_ -ne '' }).Count) {
      throw 'The dashboard type registration changed after the test; nothing was removed.'
    }
  }
  # Both absolute registry targets were checked above against this test's
  # exact names and ownership before either key is deleted.
  if (Test-Path -LiteralPath $extensionKey) { Remove-Item -LiteralPath $extensionKey -Recurse }
  if (Test-Path -LiteralPath $typeKey) { Remove-Item -LiteralPath $typeKey -Recurse }
  [ProgramBoardIconTest.Shell]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
  Refresh-TestFile
  Write-Output 'Removed the current-user dashboard icon test.'
  exit
}

if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) { throw "Missing icon: $iconPath" }
foreach ($key in @('Registry::HKEY_CLASSES_ROOT\.pboard', $typeKey)) {
  if ((Test-Path -LiteralPath $key) -and (Get-TestOwner $key) -ne $owner) {
    throw 'This file type already has another registration. The test will not replace it.'
  }
}
if (Test-Path -LiteralPath 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pboard\UserChoice') {
  throw 'Windows already has a user-selected .pboard handler. The test will not replace it.'
}

$created = @()
try {
  foreach ($key in @($typeKey, $extensionKey)) {
    if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null; $created += $key }
    New-ItemProperty -LiteralPath $key -Name 'ProgramBoardTestOwner' -Value $owner -PropertyType String -Force | Out-Null
  }
  Set-Item -LiteralPath $typeKey -Value 'Program Dashboard Project'
  New-Item -Path "$typeKey\DefaultIcon" -Force | Out-Null
  Set-Item -LiteralPath "$typeKey\DefaultIcon" -Value ('"' + $iconPath + '",0')
  # Explorer can select the extension's own icon independently of any app.
  New-Item -Path "$extensionKey\DefaultIcon" -Force | Out-Null
  Set-Item -LiteralPath "$extensionKey\DefaultIcon" -Value ('"' + $iconPath + '",0')
  Set-Item -LiteralPath $extensionKey -Value $progId
  [ProgramBoardIconTest.Shell]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
  Refresh-TestFile
} catch {
  # Roll back only exact test-created keys if registration fails partway.
  foreach ($key in @($extensionKey, $typeKey)) {
    if ($key -in $created -and (Get-TestOwner $key) -eq $owner) { Remove-Item -LiteralPath $key -Recurse }
  }
  throw
}
Write-Output 'Registered .pboard as Program Dashboard Project for the current user.'
Write-Output "Icon: $iconPath"
Write-Output "Undo: powershell -File `"$PSCommandPath`" -Remove"
