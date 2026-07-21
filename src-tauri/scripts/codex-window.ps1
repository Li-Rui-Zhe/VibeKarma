param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Collections.Generic;
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

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public INPUTUNION U;
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

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    public static extern uint SendInput(uint count, INPUT[] inputs, int size);

    public static void SendUnicode(string text) {
        var inputs = new List<INPUT>(text.Length * 2);
        foreach (char character in text) {
            var down = new INPUT { type = 1 };
            down.U.ki.wScan = character;
            down.U.ki.dwFlags = 0x0004;
            inputs.Add(down);

            var up = new INPUT { type = 1 };
            up.U.ki.wScan = character;
            up.U.ki.dwFlags = 0x0004 | 0x0002;
            inputs.Add(up);
        }
        var payload = inputs.ToArray();
        if (SendInput((uint)payload.Length, payload, Marshal.SizeOf(typeof(INPUT))) != payload.Length) {
            throw new InvalidOperationException("Windows did not accept the complete text input");
        }
    }

    public static void PressEnter() {
        var down = new INPUT { type = 1 };
        down.U.ki.wVk = 0x0D;
        var up = new INPUT { type = 1 };
        up.U.ki.wVk = 0x0D;
        up.U.ki.dwFlags = 0x0002;
        var payload = new [] { down, up };
        if (SendInput(2, payload, Marshal.SizeOf(typeof(INPUT))) != 2) {
            throw new InvalidOperationException("Windows did not accept the Enter key");
        }
    }
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

function Get-CodexUiState($window) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
    if (-not $root) { throw "Unable to inspect the Codex interface" }
    $all = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    $working = $false
    $editor = $null
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
            if (
                $element.Current.ClassName -like "ProseMirror*" -and
                $element.Current.IsKeyboardFocusable -and
                -not $element.Current.IsOffscreen
            ) {
                $editor = $element
            }
        } catch {}
    }
    $editorHasDraft = $false
    if ($editor) {
        try {
            $textPattern = $null
            if ($editor.TryGetCurrentPattern(
                [System.Windows.Automation.TextPattern]::Pattern,
                [ref]$textPattern
            )) {
                $editorText = ([System.Windows.Automation.TextPattern]$textPattern).DocumentRange.GetText(-1).Trim()
                $emptyLabels = @(
                    ([string]([char]0x968F) + [char]0x5FC3 + [char]0x8F93 + [char]0x5165),
                    "Describe a task",
                    "Ask Codex"
                )
                $editorHasDraft = $editorText -and $editorText -notin $emptyLabels
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
        Root = $root
        Editor = $editor
        Working = $working
        EditorHasDraft = $editorHasDraft
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

    $state = Get-CodexUiState $window
    if ($env:VIBEKARMA_ACTION -eq "send") {
        if (-not $state.Editor) { throw "The Codex input editor was not found" }
        if ($state.EditorHasDraft) { throw "The Codex input editor contains an unsent draft" }
        $text = $env:VIBEKARMA_TEXT
        if ([string]::IsNullOrWhiteSpace($text)) { throw "The feedback text was empty" }
        [void][VibeKarmaNative]::ShowWindow([IntPtr]$window.Handle, 9)
        [void][VibeKarmaNative]::SetForegroundWindow([IntPtr]$window.Handle)
        Start-Sleep -Milliseconds 80
        $state.Editor.SetFocus()
        Start-Sleep -Milliseconds 80
        [VibeKarmaNative]::SendUnicode($text)
        Start-Sleep -Milliseconds 60
        [VibeKarmaNative]::PressEnter()
    }

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
        editorFound = [bool]$state.Editor
        editorHasDraft = $state.EditorHasDraft
        context = $state.Context
    } | ConvertTo-Json -Compress
} catch {
    [pscustomobject]@{ ok = $false; found = $true; error = $_.Exception.Message } |
        ConvertTo-Json -Compress
    exit 1
}
