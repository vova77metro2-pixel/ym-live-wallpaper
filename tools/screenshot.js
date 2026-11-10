'use strict';
// Снимает скриншоты окна Яндекс Музыки для README.
// Использует PowerShell + System.Drawing, без внешних зависимостей.
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'docs');
fs.mkdirSync(OUT, { recursive: true });

const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Cap {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);

  public static List<IntPtr> FindYM() {
    var found = new List<IntPtr>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      var t = sb.ToString();
      if (t.Contains("Музыка") || t.Contains("Яндекс") || t.Contains("Yandex")) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$wins = [Cap]::FindYM()
if ($wins.Count -eq 0) { Write-Output "NO_WINDOW"; exit 1 }
$h = $wins[0]
[Cap]::ShowWindow($h, 9) | Out-Null
[Cap]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 1200
$r = New-Object Cap+RECT
[Cap]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
if ($w -lt 200 -or $ht -lt 200) { Write-Output "TOO_SMALL: $w x $ht"; exit 1 }
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $ht)))
$bmp.Save("__OUT__", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "OK: ${w}x${ht}"
`;

function shoot(name) {
  const target = path.join(OUT, name);
  const script = ps.replace('__OUT__', target.replace(/\\/g, '\\\\'));
  const tmp = path.join(require('os').tmpdir(), 'ymwp-shot.ps1');
  fs.writeFileSync(tmp, '\uFEFF' + script, 'utf8');
  try {
    const res = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], {
      encoding: 'utf8', timeout: 30000
    }).trim();
    console.log(name + ': ' + res);
    return res.startsWith('OK');
  } catch (e) {
    console.log(name + ': FAIL ' + (e.stdout || e.message));
    return false;
  }
}

const name = process.argv[2] || 'screenshot.png';
shoot(name);
