# ShopBotHelper.ps1 - lets swarf's Run mode drive ShopBot 3 on this laptop.
#
# ShopBot 3 publishes its state and takes commands through the registry
# (Programming Handbook "Windows Registry Interface"):
#   HKCU\Software\VB and VBA Program Settings\ShopBot\UserData
#     Loc_1..3            tool location (mm on this machine)
#     Status              bits: 1 file running, 2 preview, 4 keypad open,
#                         8 paused, 16 stop hit, 32 moves executing
#     uCommand            one command; ShopBot clears it when read
#     uMsgBoxCaption/Message, uResponse   a question ShopBot is waiting on
# This script serves that as JSON on http://localhost:8139 and queues
# commands so each one goes in only after ShopBot has taken the last.
# Windows PowerShell 5.1, no install, no admin.

$ErrorActionPreference = 'Stop'
$Port    = 8139
$UD      = 'HKCU:\Software\VB and VBA Program Settings\ShopBot\UserData'
$Origins = @('https://renato.design', 'http://localhost:8080', 'http://127.0.0.1:8080')
$JobDir  = 'C:\SbParts\swarf'
$Swarf   = 'https://renato.design/swarf-app/#run'
# Test mode (any OS): UserData lives in this JSON file instead of the registry,
# ShopBot counts as open, and nothing is launched or keyed.
$Fake    = $env:SWARF_HELPER_FAKE
if ($Fake) { $JobDir = Join-Path ([IO.Path]::GetTempPath()) 'swarf-jobs' }

function Find-Sb3 {
    $p = $null
    try { $p = (Get-ItemProperty $UD -ErrorAction Stop).uAppPath } catch {}
    foreach ($c in @($(if ($p) { Join-Path $p 'Sb3.exe' }), "${env:ProgramFiles(x86)}\ShopBot\ShopBot 3\Sb3.exe", "$env:ProgramFiles\ShopBot\ShopBot 3\Sb3.exe")) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}
function Sb3-Process {
    if ($Fake) { return [pscustomobject]@{ MainWindowHandle = [IntPtr]::Zero; Fake = $true } }
    Get-Process -Name Sb3 -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

if (-not $Fake) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    public static void Tap(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@
}

$queue = New-Object System.Collections.Queue
$log   = New-Object System.Collections.ArrayList
function Note($s) { $line = '{0}  {1}' -f (Get-Date).ToString('HH:mm:ss'), $s; Write-Host $line; [void]$log.Add($line); if ($log.Count -gt 200) { $log.RemoveAt(0) } }

function Read-UD {
    if ($Fake) { try { return Get-Content $Fake -Raw | ConvertFrom-Json } catch { return $null } }
    try { return Get-ItemProperty $UD -ErrorAction Stop } catch { return $null }
}
function Set-UD($name, $value) {
    if ($Fake) {
        $o = Get-Content $Fake -Raw | ConvertFrom-Json
        $o | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force
        $o | ConvertTo-Json | Set-Content $Fake
        return
    }
    Set-ItemProperty -Path $UD -Name $name -Value $value
}
function Num($v) { $d = 0.0; if ([double]::TryParse(([string]$v).Trim(), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$d)) { return $d } return 0.0 }

function Status-Json {
    $u = Read-UD
    $sb = [bool](Sb3-Process)
    $st = 0; if ($u) { $st = [int](Num $u.Status) }
    $dialog = 'null'
    if ($u -and ([string]$u.uMsgBoxCaption).Trim()) {
        $dialog = '{"caption":' + (ConvertTo-Json ([string]$u.uMsgBoxCaption)) + ',"message":' + (ConvertTo-Json ([string]$u.uMsgBoxMessage)) + '}'
    }
    $pos = '{"x":0,"y":0,"z":0}'
    if ($u) { $pos = '{"x":' + (Num $u.Loc_1).ToString([Globalization.CultureInfo]::InvariantCulture) + ',"y":' + (Num $u.Loc_2).ToString([Globalization.CultureInfo]::InvariantCulture) + ',"z":' + (Num $u.Loc_3).ToString([Globalization.CultureInfo]::InvariantCulture) + '}' }
    $note = if (-not $sb) { 'ShopBot 3 is not open' } elseif ($queue.Count) { "sending $($queue.Count) command(s)" } else { '' }
    $b = { param($bit) if ($st -band $bit) { 'true' } else { 'false' } }
    return '{"sb3":' + $(if ($sb) { 'true' } else { 'false' }) +
           ',"pos":' + $pos +
           ',"status":' + $st +
           ',"running":' + (& $b 1) + ',"preview":' + (& $b 2) + ',"keypad":' + (& $b 4) + ',"paused":' + (& $b 8) +
           ',"moving":' + (& $b 32) +
           ',"spindle":' + $(if ($u -and (Num $u.SpindleStatus) -ne 0) { 'true' } else { 'false' }) +
           ',"queued":' + $queue.Count +
           ',"dialog":' + $dialog +
           ',"note":' + (ConvertTo-Json $note) + '}'
}

# One command into uCommand when ShopBot has taken the previous one.
$sentAt = $null
function Pump {
    if (-not $queue.Count) { return }
    $u = Read-UD
    if (-not $u) { return }
    if (([string]$u.uCommand).Trim()) {
        if ($sentAt -and ((Get-Date) - $sentAt).TotalSeconds -gt 10) { Note "ShopBot has not taken '$($u.uCommand)' in 10 s (is a dialog open in ShopBot?)"; $script:sentAt = Get-Date }
        return
    }
    $c = [string]$queue.Dequeue()
    Set-UD uCommand $c
    $script:sentAt = Get-Date
    Note "-> $c"
}

function Stop-Motion {
    # ShopBot's stop is the space bar in its own window (Users Guide: "the
    # SPACEBAR becomes a STOP BUTTON"). It stops motion and asks continue/quit.
    $queue.Clear()
    $p = Sb3-Process
    if (-not $p) { return $false }
    if ($Fake) { Note 'stop: (test mode) space bar'; return $true }
    [void][Win]::ShowWindow($p.MainWindowHandle, 9)
    [void][Win]::SetForegroundWindow($p.MainWindowHandle)
    Start-Sleep -Milliseconds 60
    [Win]::Tap(0x20)
    Note 'stop: space bar sent to ShopBot'
    return $true
}

function Reply($ctx, $code, $body, $type) {
    $res = $ctx.Response
    $o = $ctx.Request.Headers['Origin']
    if ($o -and ($Origins -contains $o)) {
        $res.AddHeader('Access-Control-Allow-Origin', $o)
        $res.AddHeader('Vary', 'Origin')
        $res.AddHeader('Access-Control-Allow-Private-Network', 'true')
        $res.AddHeader('Access-Control-Allow-Headers', 'Content-Type')
        $res.AddHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    $res.AddHeader('Cache-Control', 'no-store')
    $res.AddHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    $res.StatusCode = $code
    $res.ContentType = $(if ($type) { $type } else { 'application/json' })
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
}

function Body($ctx) {
    $r = New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
    $t = $r.ReadToEnd(); $r.Close()
    if (-not $t) { return @{} }
    return ConvertFrom-Json $t
}

function Handle($ctx) {
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath
    $o = $req.Headers['Origin']
    if ($o -and -not ($Origins -contains $o)) { Reply $ctx 403 '{"error":"origin not allowed"}'; return }
    if ($req.HttpMethod -eq 'OPTIONS') { Reply $ctx 204 ''; return }
    switch ($path) {
        '/status' { Reply $ctx 200 (Status-Json); return }
        '/log'    { Reply $ctx 200 (($log -join "`n")) 'text/plain'; return }
        '/cmd' {
            $b = Body $ctx
            if (-not (Sb3-Process)) { Reply $ctx 409 '{"error":"ShopBot 3 is not open"}'; return }
            foreach ($c in @($b.cmds)) {
                $c = [string]$c
                if ($c -match '^[A-Za-z][A-Za-z0-9]?[\s,]|^[A-Za-z][A-Za-z0-9]$') { $queue.Enqueue($c) } else { Note "refused '$c'" }
            }
            Reply $ctx 200 (Status-Json); return
        }
        '/run' {
            $b = Body $ctx
            if (-not (Sb3-Process)) { Reply $ctx 409 '{"error":"ShopBot 3 is not open"}'; return }
            $name = ([string]$b.name) -replace '[^\w\-\.]', '_'
            if (-not $name) { $name = 'swarf' }
            if ($name -notmatch '\.sbp$') { $name = ($name -replace '\.[^.]*$', '') + '.sbp' }
            New-Item -ItemType Directory -Path $JobDir -Force | Out-Null
            $file = Join-Path $JobDir $name
            [IO.File]::WriteAllText($file, [string]$b.sbp, (New-Object Text.ASCIIEncoding))
            # queued after anything already waiting (a zero pressed just before
            # must land before the file runs); only stop clears the queue
            # SP = preview mode, SM = move/cut mode; then FP runs the file with
            # proportions 1,1,1, one repetition, no offset.
            if ($b.preview) { $queue.Enqueue('SP') } else { $queue.Enqueue('SM') }
            $queue.Enqueue("FP,$file,1,1,1,1,0")
            Note "run $(if ($b.preview) { 'PREVIEW' } else { 'CUT' }): $file"
            Reply $ctx 200 (Status-Json); return
        }
        '/stop' {
            $b = Body $ctx
            $ok = Stop-Motion
            if ($b.quit) {
                # ShopBot answers its stop question through uResponse: -1 quits the file
                $t0 = Get-Date
                while (((Get-Date) - $t0).TotalSeconds -lt 3) {
                    $u = Read-UD
                    if ($u -and ([string]$u.uMsgBoxCaption).Trim()) { Set-UD uResponse '-1'; Note 'answered -1 (quit file)'; break }
                    Start-Sleep -Milliseconds 100
                }
            }
            Reply $ctx $(if ($ok) { 200 } else { 409 }) (Status-Json); return
        }
        '/answer' {
            $b = Body $ctx
            Set-UD uResponse ([string]$b.value)
            Note "answered $($b.value)"
            Reply $ctx 200 (Status-Json); return
        }
        default { Reply $ctx 404 '{"error":"not found"}' }
    }
}

# ---------------------------------------------------------------- start
$Host.UI.RawUI.WindowTitle = 'ShopBot helper for swarf - leave this open'
Write-Host ''
Write-Host '  ShopBot helper for swarf' -ForegroundColor Red
Write-Host '  Leave this window open while you use the ShopBot. Close it when you are done.'
Write-Host ''

# Run from a USB stick: copy the helper onto this laptop and put a Desktop
# shortcut there, so later sessions need only the shortcut.
if (-not $Fake) {
    try {
        $here = Split-Path -Parent $MyInvocation.MyCommand.Path
        $drive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($here))
        if ($drive.DriveType -eq 'Removable') {
            $installDir = 'C:\SbParts\swarf-helper'
            New-Item -ItemType Directory -Path $installDir -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $here 'ShopBotHelper.ps1') -Destination $installDir -Force
            Copy-Item -LiteralPath (Join-Path $here 'START SHOPBOT.bat') -Destination $installDir -Force
            $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ShopBot + swarf.lnk'
            $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
            $sc.TargetPath = Join-Path $installDir 'START SHOPBOT.bat'
            $sc.WorkingDirectory = $installDir
            $exe = Find-Sb3
            if ($exe) { $sc.IconLocation = "$exe,0" }
            $sc.Save()
            Note "installed on this laptop; next time use the 'ShopBot + swarf' shortcut on the Desktop"
        }
    } catch { Note "could not install a copy on this laptop: $($_.Exception.Message)" }
}

if (-not $Fake -and -not (Sb3-Process)) {
    $exe = Find-Sb3
    if ($exe) { Note "opening ShopBot 3"; Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) | Out-Null }
    else { Note 'ShopBot 3 (Sb3.exe) not found; open it yourself' }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch {
    Write-Host "  Could not start on port $Port. Is the helper already running in another window?" -ForegroundColor Yellow
    Read-Host '  Press Enter to close'
    exit 1
}
Note "ready on http://localhost:$Port"
if (-not $Fake) { Start-Process $Swarf | Out-Null }

$pending = $listener.GetContextAsync()
while ($listener.IsListening) {
    if ($pending.Wait(40)) {
        try { Handle $pending.Result } catch { Note "error: $($_.Exception.Message)"; try { Reply $pending.Result 500 ('{"error":' + (ConvertTo-Json $_.Exception.Message) + '}') } catch {} }
        $pending = $listener.GetContextAsync()
    }
    try { Pump } catch { Note "pump: $($_.Exception.Message)" }
}
