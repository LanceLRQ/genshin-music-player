//! SendInput 后端（仅 Windows 编译）。INPUT 结构的字段取值由平台无关的 `KeyStroke` 决定。

use windows::Win32::Foundation::GetLastError;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT, SendInput, VIRTUAL_KEY,
};

use super::{InputBackend, KeyStroke, key_strokes};
use crate::error::CoreError;
use crate::keymap::KeyInfo;

#[derive(Debug, Default)]
pub struct WindowsBackend;

/// wVk 为 0，只用扫描码
pub fn to_input(stroke: &KeyStroke) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: stroke.scan,
                dwFlags: KEYBD_EVENT_FLAGS(stroke.flags()),
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

impl InputBackend for WindowsBackend {
    fn send_raw(&mut self, up: &[KeyInfo], down: &[KeyInfo]) -> Result<(), CoreError> {
        let inputs: Vec<INPUT> = key_strokes(up, down).iter().map(to_input).collect();
        if inputs.is_empty() {
            return Ok(());
        }
        // SAFETY: inputs 是有效的 INPUT 数组，cbsize 为单个 INPUT 的字节数
        let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
        if (sent as usize) < inputs.len() {
            // SAFETY: 紧接在失败的系统调用之后读取线程的最后错误码
            let error = unsafe { GetLastError() };
            return Err(CoreError::input_send_failed(error.0));
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "windows"
    }
}

#[cfg(test)]
mod tests {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE,
    };

    use super::*;
    use crate::input::{FLAG_EXTENDED_KEY, FLAG_KEY_UP, FLAG_SCANCODE};

    #[test]
    fn flag_constants_match_win32() {
        assert_eq!(FLAG_EXTENDED_KEY, KEYEVENTF_EXTENDEDKEY.0);
        assert_eq!(FLAG_KEY_UP, KEYEVENTF_KEYUP.0);
        assert_eq!(FLAG_SCANCODE, KEYEVENTF_SCANCODE.0);
    }

    #[test]
    fn to_input_builds_scancode_keyboard_input() {
        let input = to_input(&KeyStroke {
            scan: 16,
            extended: true,
            key_up: true,
        });
        assert_eq!(input.r#type, INPUT_KEYBOARD);
        // SAFETY: to_input 总是写入 ki 分支
        let ki = unsafe { input.Anonymous.ki };
        assert_eq!(ki.wVk, VIRTUAL_KEY(0));
        assert_eq!(ki.wScan, 16);
        assert_eq!(
            ki.dwFlags,
            KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP
        );
        assert_eq!(ki.time, 0);
        assert_eq!(ki.dwExtraInfo, 0);
    }
}
