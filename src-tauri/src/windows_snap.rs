#[cfg(windows)]
mod imp {
    use std::mem::transmute;
    use std::sync::atomic::{AtomicIsize, Ordering};
    use tauri::WebviewWindow;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW, GWLP_WNDPROC,
        HTCAPTION, HTCLIENT, WM_NCHITTEST, WNDPROC,
    };

    const TITLEBAR_HEIGHT: i32 = 36;
    const RIGHT_BUTTONS_WIDTH: i32 = 230;

    static ORIGINAL_WNDPROC: AtomicIsize = AtomicIsize::new(0);

    pub fn install(window: &WebviewWindow) {
        let Ok(hwnd) = window.hwnd() else { return };
        unsafe {
            if ORIGINAL_WNDPROC.load(Ordering::SeqCst) != 0 {
                return;
            }
            let original = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
            if original == 0 {
                return;
            }
            ORIGINAL_WNDPROC.store(original, Ordering::SeqCst);
            let _ = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, snap_wndproc as *const () as isize);
        }
    }

    unsafe extern "system" fn snap_wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        let original_raw = ORIGINAL_WNDPROC.load(Ordering::SeqCst);
        let original: WNDPROC = transmute(original_raw);
        if msg == WM_NCHITTEST {
            let default = CallWindowProcW(original, hwnd, msg, wparam, lparam);
            if default == LRESULT(HTCLIENT as isize) && point_in_caption(hwnd, lparam) {
                return LRESULT(HTCAPTION as isize);
            }
            return default;
        }
        CallWindowProcW(original, hwnd, msg, wparam, lparam)
    }

    fn point_in_caption(hwnd: HWND, lparam: LPARAM) -> bool {
        let x = loword_signed(lparam.0 as usize as u32);
        let y = hiword_signed(lparam.0 as usize as u32);
        let mut rect = RECT::default();
        let ok = unsafe { GetWindowRect(hwnd, &mut rect).is_ok() };
        if !ok {
            return false;
        }
        let local_x = x - rect.left;
        let local_y = y - rect.top;
        local_y >= 0
            && local_y < TITLEBAR_HEIGHT
            && local_x >= 0
            && local_x < (rect.right - rect.left - RIGHT_BUTTONS_WIDTH)
    }

    fn loword_signed(v: u32) -> i32 {
        (v as u16) as i16 as i32
    }

    fn hiword_signed(v: u32) -> i32 {
        ((v >> 16) as u16) as i16 as i32
    }
}

#[cfg(windows)]
pub fn install(window: &tauri::WebviewWindow) {
    imp::install(window);
}

#[cfg(not(windows))]
pub fn install(_window: &tauri::WebviewWindow) {}
