param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class VibeKarmaNative {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int count);

}
'@

function Get-CodexWindow {
    $candidates = [Collections.Generic.List[object]]::new()
    $callback = [VibeKarmaNative+EnumWindowsProc] {
        param($handle, $parameter)
        if (-not [VibeKarmaNative]::IsWindowVisible($handle)) { return $true }

        $processId = [uint32]0
        [void][VibeKarmaNative]::GetWindowThreadProcessId($handle, [ref]$processId)
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (-not $process -or $process.ProcessName -ne "ChatGPT") { return $true }

        try { $path = $process.Path } catch { return $true }
        if ($path -notlike "*OpenAI.Codex_*") { return $true }

        $className = [Text.StringBuilder]::new(128)
        [void][VibeKarmaNative]::GetClassName($handle, $className, $className.Capacity)
        if ($className.ToString() -notlike "Chrome_WidgetWin_*") { return $true }

        $rect = New-Object VibeKarmaNative+RECT
        [void][VibeKarmaNative]::GetWindowRect($handle, [ref]$rect)
        $width = $rect.Right - $rect.Left
        $height = $rect.Bottom - $rect.Top
        if ($width -lt 400 -or $height -lt 300) { return $true }

        $candidates.Add([pscustomobject]@{
            Handle = $handle.ToInt64()
            ProcessId = $processId
            Left = $rect.Left
            Top = $rect.Top
            Width = $width
            Height = $height
            Area = $width * $height
        })
        return $true
    }
    [void][VibeKarmaNative]::EnumWindows($callback, [IntPtr]::Zero)
    return $candidates | Sort-Object Area -Descending | Select-Object -First 1
}

function Get-CodexReadOnlyState($window) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
    if (-not $root) { throw "Unable to inspect the Codex interface" }

    $all = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    $working = $false
    $documentText = ""
    $contextLines = [Collections.Generic.List[string]]::new()
    $seenContext = [Collections.Generic.HashSet[string]]::new()
    $stopLabel = [string]([char]0x505C) + [char]0x6B62

    for ($index = 0; $index -lt $all.Count; $index++) {
        $element = $all.Item($index)
        try {
            if (
                -not $documentText -and
                $element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document
            ) {
                $documentPattern = $null
                if ($element.TryGetCurrentPattern(
                    [System.Windows.Automation.TextPattern]::Pattern,
                    [ref]$documentPattern
                )) {
                    $documentText = ([System.Windows.Automation.TextPattern]$documentPattern).DocumentRange.GetText(-1)
                }
            }
            if (
                $element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and
                -not $element.Current.IsOffscreen
            ) {
                $line = $element.Current.Name.Trim()
                if ($line.Length -ge 2 -and $line.Length -le 2000 -and $seenContext.Add($line)) {
                    $contextLines.Add($line)
                }
            }
            if (
                $element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
                $element.Current.Name -eq $stopLabel -and
                $element.Current.IsEnabled -and
                -not $element.Current.IsOffscreen
            ) {
                $working = $true
            }
        } catch {}
    }

    $context = $documentText.Replace([string][char]0xFFFC, "").Trim()
    if (-not $context) {
        $context = (($contextLines | Select-Object -Last 40) -join "`n")
    }
    if ($context.Length -gt 12000) {
        $context = $context.Substring($context.Length - 12000)
    }

    return [pscustomobject]@{
        Working = $working
        Context = $context
    }
}

try {
    $window = Get-CodexWindow
    if (-not $window) {
        [pscustomobject]@{ ok = $false; found = $false; error = "No visible Codex window was found" } |
            ConvertTo-Json -Compress
        exit 0
    }

    $state = Get-CodexReadOnlyState $window

    [pscustomobject]@{
        ok = $true
        found = $true
        handle = $window.Handle
        processId = $window.ProcessId
        left = $window.Left
        top = $window.Top
        width = $window.Width
        height = $window.Height
        working = $state.Working
        editorFound = $false
        editorHasDraft = $false
        context = $state.Context
    } | ConvertTo-Json -Compress
} catch {
    [pscustomobject]@{ ok = $false; found = $false; error = $_.Exception.Message } |
        ConvertTo-Json -Compress
    exit 1
}
