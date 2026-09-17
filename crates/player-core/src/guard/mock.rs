use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use super::WindowProbe;

/// 默认目标在前台；clone 出来的句柄共享同一个状态，测试中可以随时切换
#[derive(Debug, Clone)]
pub struct MockProbe {
    foreground: Arc<AtomicBool>,
}

impl Default for MockProbe {
    fn default() -> Self {
        Self {
            foreground: Arc::new(AtomicBool::new(true)),
        }
    }
}

impl MockProbe {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_foreground(&self, foreground: bool) {
        self.foreground.store(foreground, Ordering::SeqCst);
    }
}

impl WindowProbe for MockProbe {
    fn is_target_foreground(&self) -> bool {
        self.foreground.load(Ordering::SeqCst)
    }
}
