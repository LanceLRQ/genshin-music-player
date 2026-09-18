#Requires -Version 5.1

# fakegamewindow.ps1 —— M5「Windows 真机验证」工具：假《原神》窗口。
#
# 本机没有《原神》时，用 RegisterClass + CreateWindowEx 造一个顶层窗口顶替游戏：
# 默认类名 UnityWndClass、标题 原神（与产品的焦点守卫规则、§7.9 探针默认值一致），
# 置前后跑消息泵，到 -Seconds 超时、窗口被关闭或 Ctrl+C 时优雅退出。
# 窗口过程只需要默认处理（按键由 keyprobe 在系统层捕获，窗口本身不响应内容）。
#
# 用法：
#   fakegamewindow.ps1 [-Class UnityWndClass] [-Title 原神] [-Seconds 60]
#
# 注意：Win11 有前台锁，SetForegroundWindow 可能失败；失败时会提示手动点一下
# 窗口置前，这不算失败（工具本身照常运行）。

param(
    [string]$Class = 'UnityWndClass',   # 与产品守卫规则匹配的默认类名
    [string]$Title = '原神',            # 默认标题（§7.9：原神 / Genshin Impact）
    [double]$Seconds = 60               # 多少秒后自动关闭
)

if (-not ('FakeGameWindow' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

// 假游戏窗口的实现：注册窗口类 → 建顶层可见窗口 → 置前 → 消息泵到超时/关闭。
public static class FakeGameWindow
{
    const uint WM_QUIT = 0x0012;
    const uint WM_TIMER = 0x0113;
    const uint WM_DESTROY = 0x0002;
    const int SW_SHOW = 5;
    const int SW_MINIMIZE = 6;
    const int SW_RESTORE = 9;
    const uint WS_OVERLAPPEDWINDOW = 0x00CF0000;
    const uint WS_VISIBLE = 0x10000000;
    const int CW_USEDEFAULT = unchecked((int)0x80000000);
    const uint IDC_ARROW = 32512;
    const uint VK_MENU = 0x12;         // ALT
    const uint KEYEVENTF_KEYUP = 0x0002;

    delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

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
    struct WNDCLASSW
    {
        public uint style;
        public IntPtr lpfnWndProc;   // 存函数指针，见 Run 里的 GetFunctionPointerForDelegate
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszMenuName;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszClassName;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern ushort RegisterClassW(ref WNDCLASSW lpWndClass);
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateWindowExW(uint dwExStyle, string lpClassName, string lpWindowName,
        uint dwStyle, int x, int y, int nWidth, int nHeight,
        IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);
    [DllImport("user32.dll")]
    static extern IntPtr DefWindowProcW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
    [DllImport("user32.dll")]
    static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("user32.dll")]
    static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")]
    static extern bool DestroyWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    static extern void PostQuitMessage(int nExitCode);
    [DllImport("user32.dll")]
    static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr LoadCursorW(IntPtr hInstance, uint lpCursorName);
    [DllImport("user32.dll")]
    static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
    [DllImport("user32.dll")]
    static extern bool TranslateMessage(ref MSG lpMsg);
    [DllImport("user32.dll")]
    static extern IntPtr DispatchMessage(ref MSG lpMsg);
    [DllImport("user32.dll")]
    static extern IntPtr SetTimer(IntPtr hWnd, IntPtr nIDEvent, uint uElapse, IntPtr lpTimerFunc);
    [DllImport("user32.dll")]
    static extern bool KillTimer(IntPtr hWnd, IntPtr nIDEvent);
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);

    static WndProcDelegate _wndProc; // 保存委托引用，防止被 GC 回收后窗口过程指向野指针

    public static void Run(string className, string title, double seconds)
    {
        // 本进程若被 CREATE_NEW_PROCESS_GROUP 方式启动（如 Start-Process），Ctrl+C 默认被禁用；
        // 先显式恢复 Ctrl+C，保证自动化场景下也能优雅退出（交互场景下该调用幂等无害）。
        SetConsoleCtrlHandler(IntPtr.Zero, false);

        _wndProc = WndProc;
        IntPtr hInst = GetModuleHandle(null);

        WNDCLASSW wc = new WNDCLASSW();
        wc.lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_wndProc);
        wc.hInstance = hInst;
        wc.hCursor = LoadCursorW(IntPtr.Zero, IDC_ARROW);
        wc.hbrBackground = (IntPtr)6; // COLOR_WINDOW + 1：白底，窗口有内容可画
        wc.lpszClassName = className;
        if (RegisterClassW(ref wc) == 0)
            throw new Win32Exception(Marshal.GetLastWin32Error(),
                string.Format("RegisterClass 失败（类名\"{0}\"可能已被本进程注册）", className));

        IntPtr hwnd = CreateWindowExW(0, className, title,
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            CW_USEDEFAULT, CW_USEDEFAULT, 800, 600,
            IntPtr.Zero, IntPtr.Zero, hInst, IntPtr.Zero);
        if (hwnd == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateWindowEx 失败");

        ShowWindow(hwnd, SW_SHOW);

        // Win11 有前台锁，后台进程直接 SetForegroundWindow 常被拒绝或随即被前台窗口抢回
        //（VS Installer 这类提权窗口特别明显）。这里依次试三招并验证结果：
        // 直接置前 → 模拟 ALT 解锁 → AttachThreadInput 借前台线程 → 最小化再还原；
        // 每次都用 GetForegroundWindow()==hwnd 确认，最多重试 5 轮，仍失败才提示手动点击。
        bool foreground = false;
        for (int attempt = 1; attempt <= 5 && !foreground; attempt++)
        {
            foreground = ForceForeground(hwnd);
            if (!foreground) System.Threading.Thread.Sleep(700);
        }
        if (foreground)
            Console.WriteLine("假游戏窗口已创建并置前（已验证前台）：hwnd=0x{0:X} 类名={1} 标题={2}",
                hwnd.ToInt64(), className, title);
        else
            Console.WriteLine("警告：SetForegroundWindow 失败（系统前台锁/前台窗口权限更高），请手动点击一下窗口使其置前；不影响本工具继续运行。");

        Console.WriteLine("将在 {0} 秒后自动关闭，也可以直接关闭窗口或 Ctrl+C 退出。", seconds);

        // -Seconds 到时经 WM_TIMER → DestroyWindow → WM_DESTROY → PostQuitMessage 退出
        IntPtr timerId = SetTimer(hwnd, (IntPtr)1, (uint)Math.Ceiling(seconds * 1000), IntPtr.Zero);
        // 有意不做"前台保持"：§7.1 的焦点守卫测试要求本窗口能正常失焦（Alt+Tab 后触发
        // Paused(focusLost)），若自动抢回前台会破坏守卫语义。

        // Ctrl+C 也优雅退出（与 keyprobe.listen 同一套思路：不让进程被硬杀）
        uint pumpThread = GetCurrentThreadId();
        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e)
        {
            e.Cancel = true;
            PostThreadMessage(pumpThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        };

        try
        {
            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
                if (msg.message == WM_TIMER && msg.wParam == timerId)
                    DestroyWindow(hwnd); // 触发 WM_DESTROY → PostQuitMessage → 下一轮 GetMessage 返回 0
            }
        }
        finally
        {
            if (timerId != IntPtr.Zero) KillTimer(hwnd, timerId);
            if (hwnd != IntPtr.Zero && IsWindow(hwnd)) DestroyWindow(hwnd);
            Console.WriteLine("假游戏窗口已退出（类名={0} 标题={1}）。", className, title);
        }
    }

    // 置前尝试组合拳，返回"确实成为前台窗口"与否（以 GetForegroundWindow() 验证为准）
    static bool ForceForeground(IntPtr hwnd)
    {
        if (SetForegroundWindow(hwnd) && GetForegroundWindow() == hwnd) return true;

        // 模拟一次 ALT 按下/抬起：系统会把"最近有本进程输入"视为可授予前台
        keybd_event((byte)VK_MENU, 0, 0, UIntPtr.Zero);
        keybd_event((byte)VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        if (SetForegroundWindow(hwnd) && GetForegroundWindow() == hwnd) return true;

        // AttachThreadInput：把自己线程临时挂到当前前台线程的输入队列，借它的权限置前
        IntPtr fg = GetForegroundWindow();
        uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
        uint myThread = GetCurrentThreadId();
        if (fgThread != 0 && fgThread != myThread)
        {
            AttachThreadInput(myThread, fgThread, true);
            BringWindowToTop(hwnd);
            bool ok = SetForegroundWindow(hwnd);
            AttachThreadInput(myThread, fgThread, false);
            if (ok && GetForegroundWindow() == hwnd) return true;
        }

        // 最小化再还原：恢复窗口时系统通常允许重新置前
        ShowWindow(hwnd, SW_MINIMIZE);
        ShowWindow(hwnd, SW_RESTORE);
        if (SetForegroundWindow(hwnd) && GetForegroundWindow() == hwnd) return true;

        return false;
    }

    // 窗口过程：只处理 WM_DESTROY，其余全部走默认处理（足够本工具使用）
    static IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WM_DESTROY) PostQuitMessage(0);
        return DefWindowProcW(hWnd, msg, wParam, lParam);
    }
}
'@
}

try {
    [FakeGameWindow]::Run($Class, $Title, $Seconds)
    exit 0
}
catch {
    Write-Error $_
    exit 1
}
