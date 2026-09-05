pub mod bilibili;
pub mod douyu;
pub mod http;
pub mod huya;

/// Whether the NVIDIA proprietary driver is loaded on this machine.
///
/// On Linux this combo forces WebKitGTK off its DMABUF video path (see
/// `run()` in lib.rs) and onto software compositing territory, so the
/// platform should prefer lighter stream defaults (30fps variants instead
/// of Douyu's 63fps 原画).
pub fn nvidia_driver_loaded() -> bool {
    #[cfg(target_os = "linux")]
    return std::path::Path::new("/proc/driver/nvidia/version").exists();
    #[cfg(not(target_os = "linux"))]
    false
}
