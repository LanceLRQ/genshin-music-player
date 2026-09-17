//! 平台功能：提权检测与重启、计时器精度、线程优先级。非 Windows 平台为空实现。

use crate::error::CoreError;

/// 按 Windows 命令行解析规则（CommandLineToArgvW）给单个参数加引号
pub fn quote_windows_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '\u{b}', '"']) {
        return arg.to_string();
    }
    let mut quoted = String::from('"');
    let mut backslashes = 0;
    for ch in arg.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                quoted.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
                quoted.push('"');
                backslashes = 0;
            }
            _ => {
                quoted.extend(std::iter::repeat_n('\\', backslashes));
                quoted.push(ch);
                backslashes = 0;
            }
        }
    }
    quoted.extend(std::iter::repeat_n('\\', backslashes * 2));
    quoted.push('"');
    quoted
}

/// 把参数列表拼成一条命令行（用于 ShellExecuteW 的 lpParameters）
pub fn windows_command_line(args: &[String]) -> String {
    args.iter()
        .map(|arg| quote_windows_arg(arg))
        .collect::<Vec<_>>()
        .join(" ")
}

/// 进程是否以管理员身份运行；非 Windows 平台返回 None
#[cfg(windows)]
pub fn is_elevated() -> Option<bool> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token = HANDLE::default();
    // SAFETY: 只以查询权限打开本进程的令牌
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }.ok()?;
    let mut elevation = TOKEN_ELEVATION::default();
    let mut returned = 0u32;
    // SAFETY: 缓冲区是 TOKEN_ELEVATION，长度与之匹配
    let result = unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            Some((&raw mut elevation).cast()),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        )
    };
    // SAFETY: token 由 OpenProcessToken 成功打开
    let _ = unsafe { CloseHandle(token) };
    result.ok()?;
    Some(elevation.TokenIsElevated != 0)
}

#[cfg(not(windows))]
pub fn is_elevated() -> Option<bool> {
    None
}

/// 以管理员身份重新启动当前程序（带原参数）。成功后由调用方退出当前进程。
/// ShellExecute 可能委托给通过 COM 激活的 Shell 扩展，调用前先在当前线程初始化 COM。
#[cfg(windows)]
pub fn restart_as_admin() -> Result<(), CoreError> {
    use windows::Win32::System::Com::{
        COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoUninitialize,
    };
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::{HSTRING, PCWSTR};

    let exe = std::env::current_exe().map_err(|_| CoreError::elevation_failed())?;
    let args: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let operation = HSTRING::from("runas");
    let file = HSTRING::from(exe.as_path());
    let parameters = HSTRING::from(windows_command_line(&args));
    // SAFETY: 无指针参数；返回 S_OK 或 S_FALSE（已初始化过）时都要配对调用 CoUninitialize
    let com_initialized =
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) }.is_ok();
    // SAFETY: 所有字符串参数在调用期间有效
    let instance = unsafe {
        ShellExecuteW(
            None,
            &operation,
            &file,
            &parameters,
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if com_initialized {
        // SAFETY: 与上面成功的 CoInitializeEx 配对
        unsafe { CoUninitialize() };
    }
    // 返回值 ≤ 32 表示失败（用户取消 UAC 也会走到这里）
    if instance.0 as isize <= 32 {
        return Err(CoreError::elevation_failed());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn restart_as_admin() -> Result<(), CoreError> {
    Err(CoreError::not_supported())
}

/// 持有期间把系统计时器精度设为 1ms（Windows 上 timeBeginPeriod(1)，Drop 时 timeEndPeriod(1)）
#[derive(Debug)]
pub struct TimerResolutionGuard {
    active: bool,
}

impl TimerResolutionGuard {
    pub fn acquire() -> Self {
        Self {
            active: begin_timer_period(),
        }
    }

    /// 是否真的调高了精度（非 Windows 平台恒为 false）
    pub fn is_active(&self) -> bool {
        self.active
    }
}

impl Drop for TimerResolutionGuard {
    fn drop(&mut self) {
        if self.active {
            end_timer_period();
        }
    }
}

#[cfg(windows)]
fn begin_timer_period() -> bool {
    use windows::Win32::Media::{TIMERR_NOERROR, timeBeginPeriod};
    // SAFETY: 无指针参数
    unsafe { timeBeginPeriod(1) == TIMERR_NOERROR }
}

#[cfg(windows)]
fn end_timer_period() {
    use windows::Win32::Media::timeEndPeriod;
    // SAFETY: 与 begin_timer_period 成对调用
    unsafe {
        timeEndPeriod(1);
    }
}

#[cfg(not(windows))]
fn begin_timer_period() -> bool {
    false
}

#[cfg(not(windows))]
fn end_timer_period() {}

/// 把当前线程优先级设为 THREAD_PRIORITY_HIGHEST，返回是否成功（非 Windows 平台恒为 false）
#[cfg(windows)]
pub fn raise_thread_priority() -> bool {
    use windows::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_HIGHEST,
    };
    // SAFETY: GetCurrentThread 返回当前线程的伪句柄
    unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST) }.is_ok()
}

#[cfg(not(windows))]
pub fn raise_thread_priority() -> bool {
    false
}
