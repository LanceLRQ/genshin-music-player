use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use super::InputBackend;
use crate::error::CoreError;
use crate::keymap::KeyInfo;

/// 模拟"拒绝访问"（ERROR_ACCESS_DENIED）
pub const MOCK_OS_ERROR: u32 = 5;

/// MockBackend 记录的一次调用
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentKeys {
    pub up: Vec<String>,
    pub down: Vec<String>,
}

/// 只记录，不发键。clone 出来的句柄共享同一份记录，测试可以在后端被移走后继续读取。
#[derive(Debug, Clone, Default)]
pub struct MockBackend {
    calls: Arc<Mutex<Vec<SentKeys>>>,
    fail_next: Arc<AtomicBool>,
}

impl MockBackend {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn calls(&self) -> Vec<SentKeys> {
        self.calls
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// 让下一次调用返回 INPUT_SEND_FAILED（不记录），之后恢复正常
    pub fn fail_next_call(&self) {
        self.fail_next.store(true, Ordering::SeqCst);
    }
}

impl InputBackend for MockBackend {
    fn send_raw(&mut self, up: &[KeyInfo], down: &[KeyInfo]) -> Result<(), CoreError> {
        if self.fail_next.swap(false, Ordering::SeqCst) {
            return Err(CoreError::input_send_failed(MOCK_OS_ERROR));
        }
        let codes = |keys: &[KeyInfo]| keys.iter().map(|key| key.code.to_string()).collect();
        self.calls
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(SentKeys {
                up: codes(up),
                down: codes(down),
            });
        Ok(())
    }

    fn name(&self) -> &'static str {
        "mock"
    }
}
