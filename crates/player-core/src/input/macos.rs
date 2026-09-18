//! CGEvent 后端（仅 macOS 编译）：把按键动作转成 CGEvent 发到 HID 事件塔。
//!
//! 与 Windows 的 SendInput 扫描码不同，macOS 按虚拟键码（`kVK_ANSI_*`）发键；
//! 没有辅助功能权限时 CGEventPost 不报错但会被系统静默丢弃，所以每次发送前先显式检查。

use core_graphics::event::{CGEvent, CGEventTapLocation};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

use super::InputBackend;
use crate::error::CoreError;
use crate::keymap::{KeyInfo, mac_vk};
use crate::platform;

/// CGEventSource 按 CF 的线程规则可以跨线程使用（创建后只读）；core-graphics 没有标记 `Send`，
/// 后端在主线程创建、随后移动到播放线程独占使用，这里显式声明。
struct SharedEventSource(CGEventSource);

// SAFETY: CGEventSource 创建后不再修改，跨线程只读访问是 CF 文档允许的用法
unsafe impl Send for SharedEventSource {}

#[derive(Default)]
pub struct MacBackend {
    /// 惰性创建的事件源；创建失败（理论上仅在系统资源耗尽时）时为 None，下次发送再试
    source: Option<SharedEventSource>,
}

impl MacBackend {
    pub fn new() -> Self {
        Self::default()
    }

    fn event_source(&mut self) -> Result<CGEventSource, CoreError> {
        if let Some(source) = &self.source {
            return Ok(source.0.clone());
        }
        let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
            .map_err(|()| CoreError::input_backend_failed("无法创建 CGEventSource"))?;
        self.source = Some(SharedEventSource(source.clone()));
        Ok(source)
    }

    fn post(&mut self, key: &KeyInfo, key_down: bool) -> Result<(), CoreError> {
        let vk = mac_vk(key.code).ok_or_else(|| CoreError::unknown_key_code(key.code))?;
        let source = self.event_source()?;
        let event = CGEvent::new_keyboard_event(source, vk, key_down)
            .map_err(|()| CoreError::input_backend_failed("无法创建 CGEvent"))?;
        event.post(CGEventTapLocation::HID);
        Ok(())
    }
}

impl InputBackend for MacBackend {
    fn send_raw(&mut self, up: &[KeyInfo], down: &[KeyInfo]) -> Result<(), CoreError> {
        if up.is_empty() && down.is_empty() {
            return Ok(());
        }
        if platform::is_trusted() == Some(false) {
            return Err(CoreError::input_access_denied());
        }
        for key in up {
            self.post(key, false)?;
        }
        for key in down {
            self.post(key, true)?;
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "macos"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_name_is_macos() {
        assert_eq!(MacBackend::new().name(), "macos");
    }

    #[test]
    fn send_raw_with_nothing_to_do_short_circuits_before_permission_check() {
        assert!(MacBackend::new().send_raw(&[], &[]).is_ok());
    }
}
