//! macOS power/App-Nap management for background playback.
//!
//! Hiding the window is not enough to keep a live stream alive: once the app
//! has no visible window and no recent user interaction, macOS puts it into
//! App Nap, which throttles timers and network callbacks. The player feeds
//! MSE buffers from JS, so throttling shows up as stalls and a long re-buffer
//! the moment the window comes back.
//!
//! `NSProcessInfo.beginActivityWithOptions:reason:` opts the process out. We
//! use `UserInitiatedAllowingIdleSystemSleep` rather than the full
//! `UserInitiated` flag on purpose: it blocks App Nap but still lets the
//! machine go to sleep when idle, so a forgotten background player does not
//! drain the battery.
//!
//! Related but separate: `backgroundThrottling: "disabled"` in
//! `tauri.macos.conf.json` turns off *WebKit's* inactive scheduling
//! (`WKPreferences.inactiveSchedulingPolicy`). Both layers are needed —
//! one governs the web view, this one governs the process.

/// Opts the process out of App Nap for the rest of its lifetime.
///
/// No-op on non-macOS targets.
#[cfg(target_os = "macos")]
pub fn prevent_app_nap() {
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};

    let reason = NSString::from_str("live stream playback");
    let options = NSActivityOptions::UserInitiatedAllowingIdleSystemSleep;
    let activity = NSProcessInfo::processInfo().beginActivityWithOptions_reason(options, &reason);

    // The token must stay alive for as long as the app runs — releasing it
    // would hand the process back to App Nap. It is a process-lifetime
    // singleton, so leaking it is the intended behaviour.
    std::mem::forget(activity);
}

/// Opts the process out of App Nap for the rest of its lifetime.
#[cfg(not(target_os = "macos"))]
pub fn prevent_app_nap() {}
