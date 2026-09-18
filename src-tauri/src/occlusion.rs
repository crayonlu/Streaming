//! Keeps the web view painting while its window is off-screen.
//!
//! ## The problem
//!
//! Switching Spaces with Ctrl+←/→ left the player showing black until a new
//! segment happened to arrive. The cause is in WebKit's macOS port, not in our
//! player: painting is gated on `ActivityState::IsVisible`, and on macOS that
//! flag is computed in `PageClientImpl::isViewVisible()`:
//!
//! ```objc
//! auto windowIsOccluded = [&]()->bool {
//!     return m_impl && m_impl->windowOcclusionDetectionEnabled()
//!         && (viewWindow.occlusionState & NSWindowOcclusionStateVisible)
//!            != NSWindowOcclusionStateVisible;
//! };
//! // ...
//! if (!viewWindow.isVisible)
//!     return false;
//! if (windowIsOccluded())
//!     return false;
//! ```
//!
//! A window on an *inactive Space* is still `isVisible` — it is ordered in, it
//! is simply not composited — but it is no longer in
//! `NSWindowOcclusionStateVisible`. So `isViewVisible()` returns false, WebKit
//! clears `ActivityState::IsVisible`, and the compositor stops producing
//! frames for the page. The MSE pipeline is parked at the same time, so coming
//! back shows the stage background (near-black) until the decoder is nudged
//! into producing a frame again.
//!
//! ## The fix
//!
//! `windowOcclusionDetectionEnabled()` is a real switch, exposed on
//! `WKWebView` as the private property
//! `_setWindowOcclusionDetectionEnabled:`. With it off, `windowIsOccluded()`
//! is always false and the Space transition no longer clears
//! `ActivityState::IsVisible`, so the page keeps painting.
//!
//! This is not a hack of our own invention — it is what WebKit does for
//! itself, and what its test harness uses to make offscreen web views render:
//!
//! ```objc
//! // Source/WebKit/UIProcess/mac/WebViewImpl.mm
//! // Occlusion notifications are not always sent in the base system, and
//! // stale occlusion state can result in various misbehaviors.
//! if (isInBaseSystem())
//!     setWindowOcclusionDetectionEnabled(false);
//! ```
//!
//! ## What this does *not* cover
//!
//! `viewWindow.isVisible` is checked *outside* the flag's control. Minimising
//! the window or hiding the app (`NSApp.hide()`, which is what our
//! close-to-tray path does) makes it false, so those paths still park the
//! page. Only the off-Space case is fixed here; `useVisibilityResume` on the
//! frontend side covers the rest.
//!
//! `_setWindowOcclusionDetectionEnabled:` is a private API. That is
//! acceptable here because the app is distributed unsigned outside the App
//! Store; it would not be acceptable for a Mac App Store build.

#[cfg(target_os = "macos")]
pub fn disable_window_occlusion_detection<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{msg_send, sel};

    let result = window.with_webview(|webview| {
        let wk = webview.inner().cast::<AnyObject>();
        if wk.is_null() {
            tracing::warn!("webview handle was null; occlusion detection left enabled");
            return;
        }

        // SAFETY: `inner()` is the WKWebView owned by this window, and
        // `with_webview` runs the closure on the main thread, which is where
        // AppKit objects must be touched.
        unsafe {
            // Guarded so a WebKit build without the property degrades to the
            // old behaviour instead of throwing an unrecognised-selector
            // exception.
            let responds: Bool =
                msg_send![wk, respondsToSelector: sel!(_setWindowOcclusionDetectionEnabled:)];
            if !responds.as_bool() {
                tracing::warn!(
                    "_setWindowOcclusionDetectionEnabled: unavailable — the page will still \
                     stop painting when the window moves to another Space"
                );
                return;
            }

            let _: () = msg_send![wk, _setWindowOcclusionDetectionEnabled: Bool::NO];

            // Read it back: a silent no-op would look identical to success in
            // the logs otherwise, and this is the one thing that decides
            // whether the page keeps painting.
            let enabled: Bool = msg_send![wk, _windowOcclusionDetectionEnabled];
            if enabled.as_bool() {
                tracing::warn!("occlusion detection is still enabled after setting it to NO");
            } else {
                tracing::info!("occlusion detection now reports disabled");
            }
        }
    });

    match result {
        Ok(()) => tracing::info!("window occlusion detection disabled (page keeps painting off-Space)"),
        Err(e) => tracing::warn!("could not reach the web view to disable occlusion detection: {e}"),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn disable_window_occlusion_detection<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {
    // WebKit's occlusion gating is macOS-specific; the other backends do not
    // park the page the same way.
}
