#Requires -Version 5.1

# keyprobe.ps1 —— M5「Windows 真机验证」工具：键盘监听与注入（虚拟键盘受端）。
#
# 本机没有《原神》环境时，用它扮演"受端"：WH_KEYBOARD_LL 低级钩子能收到系统里
# 全部按键事件，包括本工具/产品用 SendInput 注入的事件（带 LLKHF_INJECTED 标志），
# 等价于一个带毫秒时间戳的键盘记录器，供后续验证任务核对键序与事件间隔。
#
# 用法：
#   keyprobe.ps1 listen -Out <文件> [-Seconds N]
#       监听全部按键，每个事件写一行 JSONL：
#       {"ts": <Stopwatch 毫秒>, "vk": <虚拟键码>, "scan": <扫描码>, "up": <bool>, "injected": <bool>, "extended": <bool>}
#       -Seconds 省略或为 0 表示一直监听，直到 Ctrl+C。
#   keyprobe.ps1 send -Key <名称如 F9|A|1> [-Times N] [-UpOnly|-DownOnly]
#       SendInput 按扫描码注入按键（与产品同源），键名大小写不敏感；
#       -Times 每次为完整一次按下+抬起；-UpOnly/-DownOnly 只注入抬起/按下。
#   keyprobe.ps1 register -Key <名称>
#       尝试 RegisterHotKey 后立即注销，输出成功/失败（1409=已被占用），
#       用于证明应用已注册全局热键（F9/F10）。成功退出码 0，失败退出码 1。
#
# 注意：listen 运行期间物理键盘按键同样会被记录，用完即关（退出时保证卸载钩子）。

# 各模式必填参数在脚本体内校验（-Key 同时属于 send/register，
# 用 ParameterSetName 会因两组都可解析而报 AmbiguousParameterSet）
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('listen', 'send', 'register')]
    [string]$Mode,

    # ---- listen 模式 ----
    [string]$Out,

    # 监听秒数；0 表示一直监听直到 Ctrl+C
    [double]$Seconds = 0,

    # ---- send / register 共用 ----
    [string]$Key,

    # ---- send 模式 ----
    [int]$Times = 1,

    [switch]$UpOnly,

    [switch]$DownOnly
)

if (-not ('KeyProbe' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// keyprobe 的 Win32 封装与三种模式的实现。
// 实现要点：
// - listen 的钩子回调、消息泵、JSONL 写入都在装钩子的同一线程上，
//   写入天然与消息泵串行，不会出现多行 JSON 交错写坏的问题。
// - LLKHF_* 常量取自 Win32 头文件 winuser.h 的官方值：
//   LLKHF_EXTENDED=0x01, LLKHF_INJECTED=0x10, LLKHF_UP=0x80。
// - 时间戳用 System.Diagnostics.Stopwatch，从监听开始起算的毫秒（double 保留小数），
//   精度远高于 1ms，足够后续任务计算事件间隔。
public static class KeyProbe
{
    // ================= 常量（取自 Win32 头文件 winuser.h 的官方值） =================
    const int WH_KEYBOARD_LL = 13;          // 低级键盘钩子
    const uint WM_QUIT = 0x0012;
    const uint WM_TIMER = 0x0113;
    const uint LLKHF_EXTENDED = 0x01;       // 扩展键（右 Ctrl/Alt、方向键等）
    const uint LLKHF_INJECTED = 0x10;       // 事件由 SendInput/keybd_event 等注入
    const uint LLKHF_UP = 0x80;             // 抬起事件（0 为按下）
    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_SCANCODE = 0x0008; // 按扫描码注入（与产品实现同源）
    const uint KEYEVENTF_KEYUP = 0x0002;
    const int HOTKEY_ID = 0x0001;           // register 模式的临时热键 id（非 0 即可）

    delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    // INPUT 联合体的大小由最大的 MOUSEINPUT 决定，所以三个成员都要定义
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct HARDWAREINPUT
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUT_UNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT
    {
        public uint type;
        public INPUT_UNION u;
    }

    // ================= P/Invoke =================
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll")]
    static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")]
    static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
    [DllImport("user32.dll")]
    static extern IntPtr SetTimer(IntPtr hWnd, IntPtr nIDEvent, uint uElapse, IntPtr lpTimerFunc);
    [DllImport("user32.dll")]
    static extern bool KillTimer(IntPtr hWnd, IntPtr nIDEvent);
    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);

    // ================= 键名映射表（大小写不敏感，后续验证任务只用这些键） =================
    // 键名 → Set-1 扫描码（make code），send 模式按扫描码注入
    static readonly Dictionary<string, uint> ScanCodes = new Dictionary<string, uint> {
        { "A", 0x1E }, { "B", 0x30 }, { "C", 0x2E }, { "D", 0x20 }, { "E", 0x12 },
        { "F", 0x21 }, { "G", 0x22 }, { "H", 0x23 }, { "I", 0x17 }, { "J", 0x24 },
        { "K", 0x25 }, { "L", 0x26 }, { "M", 0x32 }, { "N", 0x31 }, { "O", 0x18 },
        { "P", 0x19 }, { "Q", 0x10 }, { "R", 0x13 }, { "S", 0x1F }, { "T", 0x14 },
        { "U", 0x16 }, { "V", 0x2F }, { "W", 0x11 }, { "X", 0x2D }, { "Y", 0x15 },
        { "Z", 0x2C },
        { "1", 0x02 }, { "2", 0x03 }, { "3", 0x04 }, { "4", 0x05 }, { "5", 0x06 },
        { "6", 0x07 }, { "7", 0x08 }, { "8", 0x09 }, { "9", 0x0A }, { "0", 0x0B },
        { "F1", 0x3B }, { "F2", 0x3C }, { "F3", 0x3D }, { "F4", 0x3E }, { "F5", 0x3F },
        { "F6", 0x40 }, { "F7", 0x41 }, { "F8", 0x42 }, { "F9", 0x43 }, { "F10", 0x44 },
        { "F11", 0x57 }, { "F12", 0x58 }
    };

    // 键名 → 虚拟键码，register 模式用
    static readonly Dictionary<string, uint> VirtualKeys = new Dictionary<string, uint> {
        { "A", 0x41 }, { "B", 0x42 }, { "C", 0x43 }, { "D", 0x44 }, { "E", 0x45 },
        { "F", 0x46 }, { "G", 0x47 }, { "H", 0x48 }, { "I", 0x49 }, { "J", 0x4A },
        { "K", 0x4B }, { "L", 0x4C }, { "M", 0x4D }, { "N", 0x4E }, { "O", 0x4F },
        { "P", 0x50 }, { "Q", 0x51 }, { "R", 0x52 }, { "S", 0x53 }, { "T", 0x54 },
        { "U", 0x55 }, { "V", 0x56 }, { "W", 0x57 }, { "X", 0x58 }, { "Y", 0x59 },
        { "Z", 0x5A },
        { "1", 0x31 }, { "2", 0x32 }, { "3", 0x33 }, { "4", 0x34 }, { "5", 0x35 },
        { "6", 0x36 }, { "7", 0x37 }, { "8", 0x38 }, { "9", 0x39 }, { "0", 0x30 },
        { "F1", 0x70 }, { "F2", 0x71 }, { "F3", 0x72 }, { "F4", 0x73 }, { "F5", 0x74 },
        { "F6", 0x75 }, { "F7", 0x76 }, { "F8", 0x77 }, { "F9", 0x78 }, { "F10", 0x79 },
        { "F11", 0x7A }, { "F12", 0x7B }
    };

    // ================= listen 模式 =================
    class ListenState
    {
        public IntPtr Hook;
        public StreamWriter Writer;
        public Stopwatch Watch;
        public long Count;
    }

    static ListenState _listen;
    static LowLevelKeyboardProc _hookProc; // 保存委托引用，防止被 GC 回收后钩子回调指向野指针

    public static int Listen(string outPath, double seconds)
    {
        // 本进程若被 CREATE_NEW_PROCESS_GROUP 方式启动（如 Start-Process），Ctrl+C 默认被禁用；
        // 自动化验证正是这样后台启动本工具的，所以先显式恢复 Ctrl+C（交互场景下该调用幂等无害）。
        SetConsoleCtrlHandler(IntPtr.Zero, false);

        string fullPath = Path.GetFullPath(outPath);
        string dir = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        _hookProc = KeyboardHookCallback;
        _listen = new ListenState();
        _listen.Watch = Stopwatch.StartNew();
        // UTF-8 无 BOM、逐行刷新：后续任务可以边监听边读这个文件
        _listen.Writer = new StreamWriter(fullPath, false, new UTF8Encoding(false));
        _listen.Writer.AutoFlush = true;

        IntPtr hook = SetWindowsHookEx(WH_KEYBOARD_LL, _hookProc, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SetWindowsHookEx(WH_KEYBOARD_LL) 失败");
        _listen.Hook = hook;
        Console.WriteLine("keyprobe listen 已启动 → {0}（Ctrl+C 或 -Seconds 到时停止）", fullPath);

        // Ctrl+C 与 -Seconds 到时走同一条清理路径：先让消息泵退出，finally 里卸钩子、关文件。
        // 捕获条数必须在 C# 里打印：Ctrl+C 时 PowerShell 管道可能被终止，PS 层的后续语句不保证执行。
        uint pumpThread = GetCurrentThreadId();
        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e)
        {
            e.Cancel = true; // 不让进程被直接杀掉，保证钩子一定被卸载（装着钩子退出会拖慢全系统键盘）
            PostThreadMessage(pumpThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        };

        // seconds>0 时用系统定时器向本线程消息队列发 WM_TIMER，触发超时退出
        IntPtr timerId = IntPtr.Zero;
        if (seconds > 0)
            timerId = SetTimer(IntPtr.Zero, IntPtr.Zero, (uint)Math.Ceiling(seconds * 1000), IntPtr.Zero);

        try
        {
            MSG msg;
            while (true)
            {
                int r = GetMessage(out msg, IntPtr.Zero, 0, 0);
                if (r <= 0) break; // 0 = 收到 WM_QUIT（Ctrl+C 路径）；-1 = 出错
                if (msg.message == WM_TIMER && msg.wParam == timerId) break; // -Seconds 到时
            }
        }
        finally
        {
            if (timerId != IntPtr.Zero) KillTimer(IntPtr.Zero, timerId);
            if (_listen.Hook != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_listen.Hook); // 无论哪条路径退出都卸载钩子
                _listen.Hook = IntPtr.Zero;
            }
            if (_listen.Writer != null)
            {
                _listen.Writer.Flush();
                _listen.Writer.Dispose();
                _listen.Writer = null;
            }
            Console.WriteLine("keyprobe listen 结束：共捕获 {0} 条事件 → {1}", _listen.Count, fullPath);
        }
        return (int)_listen.Count;
    }

    // 低级钩子回调：与消息泵同线程，写文件天然串行
    static IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && _listen != null && _listen.Writer != null)
        {
            KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            bool up = (info.flags & LLKHF_UP) != 0;
            bool injected = (info.flags & LLKHF_INJECTED) != 0;
            bool extended = (info.flags & LLKHF_EXTENDED) != 0;
            double ts = _listen.Watch.Elapsed.TotalMilliseconds;
            _listen.Writer.WriteLine(string.Format(
                "{{\"ts\":{0},\"vk\":{1},\"scan\":{2},\"up\":{3},\"injected\":{4},\"extended\":{5}}}",
                ts.ToString("0.###", CultureInfo.InvariantCulture),
                info.vkCode, info.scanCode,
                up ? "true" : "false",
                injected ? "true" : "false",
                extended ? "true" : "false"));
            _listen.Count++;
        }
        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    // ================= send 模式 =================
    public static string Send(string key, int times, bool upOnly, bool downOnly)
    {
        string name = key.Trim().ToUpperInvariant();
        uint scan;
        if (!ScanCodes.TryGetValue(name, out scan))
            throw new ArgumentException(string.Format(
                "不支持的键名\"{0}\"：send 只支持 A-Z、0-9、F1-F12", key));

        for (int i = 0; i < times; i++)
        {
            if (!upOnly) SendScan(scan, false);
            if (!downOnly) SendScan(scan, true);
        }
        string action = upOnly ? "仅抬起" : (downOnly ? "仅按下" : "按下+抬起");
        return string.Format("已注入 {0}（扫描码 0x{1:X2}）× {2} 次，每次 {3}", name, scan, times, action);
    }

    static void SendScan(uint scan, bool up)
    {
        INPUT[] input = new INPUT[1];
        input[0].type = INPUT_KEYBOARD;
        input[0].u.ki.wVk = 0;
        input[0].u.ki.wScan = (ushort)scan;
        input[0].u.ki.dwFlags = KEYEVENTF_SCANCODE | (up ? KEYEVENTF_KEYUP : 0);
        input[0].u.ki.time = 0;
        input[0].u.ki.dwExtraInfo = IntPtr.Zero;
        if (SendInput(1, input, Marshal.SizeOf(typeof(INPUT))) != 1)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SendInput 失败");
    }

    // ================= register 模式 =================
    public static bool TestRegister(string key)
    {
        string name = key.Trim().ToUpperInvariant();
        uint vk;
        if (!VirtualKeys.TryGetValue(name, out vk))
            throw new ArgumentException(string.Format(
                "不支持的键名\"{0}\"：register 只支持 A-Z、0-9、F1-F12", key));

        if (RegisterHotKey(IntPtr.Zero, HOTKEY_ID, 0, vk))
        {
            UnregisterHotKey(IntPtr.Zero, HOTKEY_ID);
            Console.WriteLine("成功：{0}（VK=0x{1:X2}）未被占用，已注册并立即注销。", name, vk);
            return true;
        }
        int err = Marshal.GetLastWin32Error();
        if (err == 1409)
            Console.WriteLine("失败：{0}（VK=0x{1:X2}）已被其他应用占用（GetLastError=1409 ERROR_HOTKEY_ALREADY_REGISTERED）。", name, vk);
        else
            Console.WriteLine("失败：RegisterHotKey 出错（GetLastError={0}）。", err);
        return false;
    }
}
'@
}

try {
    switch ($Mode) {
        'listen' {
            if ([string]::IsNullOrWhiteSpace($Out)) { throw 'listen 需要 -Out <文件>。' }
            if ($Seconds -lt 0) { throw '-Seconds 不能为负数。' }
            # 条数已在 C# 内打印（保证 Ctrl+C 路径也能输出），这里只取返回值避免重复输出
            $null = [KeyProbe]::Listen($Out, $Seconds)
            exit 0
        }
        'send' {
            if ([string]::IsNullOrWhiteSpace($Key)) { throw 'send 需要 -Key <名称>。' }
            if ($Times -lt 1) { throw '-Times 至少为 1。' }
            if ($UpOnly -and $DownOnly) { throw '-UpOnly 与 -DownOnly 不能同时使用。' }
            Write-Host ([KeyProbe]::Send($Key, $Times, [bool]$UpOnly, [bool]$DownOnly))
            exit 0
        }
        'register' {
            if ([string]::IsNullOrWhiteSpace($Key)) { throw 'register 需要 -Key <名称>。' }
            if ([KeyProbe]::TestRegister($Key)) { exit 0 } else { exit 1 }
        }
    }
}
catch {
    Write-Error $_
    exit 1
}
