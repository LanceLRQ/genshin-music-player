//! 前台窗口检测（仅 macOS 编译）：CGWindowList 取最前面的普通层（layer 0）窗口，
//! 用应用名和窗口标题（若系统愿意给）与 `WindowRule.titles` 匹配（见 [`mac_window_matches`]）。

use std::ffi::c_void;
use std::sync::{Arc, PoisonError, RwLock};

use core_foundation::array::CFArray;
use core_foundation::base::TCFType;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use core_graphics::window::{
    CGWindowListCopyWindowInfo, kCGNullWindowID, kCGWindowListOptionOnScreenOnly,
};

use super::{WindowProbe, WindowRule, mac_window_matches};

/// 与设置共享窗口规则，保存设置后立即生效（同 WindowsProbe）
pub struct MacProbe {
    rule: Arc<RwLock<WindowRule>>,
}

impl MacProbe {
    pub fn new(rule: Arc<RwLock<WindowRule>>) -> Self {
        Self { rule }
    }
}

impl WindowProbe for MacProbe {
    fn is_target_foreground(&self) -> bool {
        let rule = self.rule.read().unwrap_or_else(PoisonError::into_inner);
        frontmost_window_info().is_some_and(|(owner, title)| {
            mac_window_matches(&rule, owner.as_deref(), title.as_deref())
        })
    }
}

/// 最前面的普通层窗口的 (应用名, 窗口标题)；拿不到时返回 None。公开给测试与界面提示使用。
/// 列表顺序即屏幕上从前到后；跳过菜单栏、Dock 等非 0 层的窗口。
pub fn frontmost_window_info() -> Option<(Option<String>, Option<String>)> {
    // SAFETY: 返回的数组归调用方所有，用 create 规则包装，drop 时释放
    let windows: CFArray<*const c_void> = unsafe {
        let ptr = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
        if ptr.is_null() {
            return None;
        }
        CFArray::wrap_under_create_rule(ptr)
    };
    for window in windows.iter() {
        // SAFETY: 数组元素是窗口描述 CFDictionary，用 get 规则包装（不获取所有权）
        let dict: CFDictionary =
            unsafe { CFDictionary::wrap_under_get_rule(*window as CFDictionaryRef) };
        let layer = number(&dict, window_layer_key());
        if layer != Some(0) {
            continue;
        }
        return Some((
            string(&dict, window_owner_name_key()),
            string(&dict, window_name_key()),
        ));
    }
    None
}

fn string(dict: &CFDictionary, key: CFStringRef) -> Option<String> {
    let value = dict.find(key as *const c_void)?;
    // SAFETY: 值是指向 CFString 的引用，用 get 规则包装（不获取所有权）
    let string: CFString =
        unsafe { CFString::wrap_under_get_rule(*value as <CFString as TCFType>::Ref) };
    Some(string.to_string())
}

fn number(dict: &CFDictionary, key: CFStringRef) -> Option<i64> {
    let value = dict.find(key as *const c_void)?;
    // SAFETY: 值是指向 CFNumber 的引用，用 get 规则包装
    let number: CFNumber =
        unsafe { CFNumber::wrap_under_get_rule(*value as <CFNumber as TCFType>::Ref) };
    number.to_i64()
}

fn window_layer_key() -> CFStringRef {
    // SAFETY: 系统导出的常量，生命周期为整个进程
    unsafe { core_graphics::window::kCGWindowLayer }
}

fn window_owner_name_key() -> CFStringRef {
    // SAFETY: 同上
    unsafe { core_graphics::window::kCGWindowOwnerName }
}

fn window_name_key() -> CFStringRef {
    // SAFETY: 同上
    unsafe { core_graphics::window::kCGWindowName }
}
