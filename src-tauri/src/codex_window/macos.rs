use std::ffi::{c_char, c_void, CStr};

use super::{CodexWindowInfo, WindowBounds};

type CFIndex = isize;
type CFTypeRef = *const c_void;
type CFArrayRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFNumberRef = *const c_void;
type CFStringRef = *const c_void;
type CGWindowID = u32;

const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
const K_CF_NUMBER_SINT64_TYPE: u32 = 4;
const K_CF_NUMBER_FLOAT64_TYPE: u32 = 6;
const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1;
const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ABOVE_WINDOW: u32 = 2;
const K_CG_WINDOW_LIST_OPTION_INCLUDING_WINDOW: u32 = 8;
const K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS: u32 = 16;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFArrayGetCount(array: CFArrayRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: CFIndex) -> *const c_void;
    fn CFDictionaryGetValue(dictionary: CFDictionaryRef, key: *const c_void) -> *const c_void;
    fn CFNumberGetValue(number: CFNumberRef, number_type: u32, value: *mut c_void) -> bool;
    fn CFRelease(value: CFTypeRef);
    fn CFStringGetCString(
        string: CFStringRef,
        buffer: *mut c_char,
        buffer_size: CFIndex,
        encoding: u32,
    ) -> u8;
    fn CFStringGetCStringPtr(string: CFStringRef, encoding: u32) -> *const c_char;
    fn CFStringGetLength(string: CFStringRef) -> CFIndex;
    fn CFStringGetMaximumSizeForEncoding(length: CFIndex, encoding: u32) -> CFIndex;
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    static kCGWindowAlpha: CFStringRef;
    static kCGWindowBounds: CFStringRef;
    static kCGWindowLayer: CFStringRef;
    static kCGWindowNumber: CFStringRef;
    static kCGWindowOwnerName: CFStringRef;
    static kCGWindowOwnerPID: CFStringRef;

    fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: CGWindowID) -> CFArrayRef;
    fn CGRectMakeWithDictionaryRepresentation(
        dictionary: CFDictionaryRef,
        rect: *mut CGRect,
    ) -> i32;
}

struct OwnedCF(CFTypeRef);

impl Drop for OwnedCF {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) };
        }
    }
}

struct MacWindow {
    id: u32,
    process_id: u32,
    owner: String,
    bounds: WindowBounds,
}

pub(super) fn inspect() -> Result<CodexWindowInfo, String> {
    let window = copy_windows(
        K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS,
        0,
    )?
    .into_iter()
    .find(|window| is_codex_owner(&window.owner));

    Ok(match window {
        Some(window) => CodexWindowInfo {
            ok: true,
            found: true,
            handle: i64::from(window.id),
            process_id: window.process_id,
            left: window.bounds.left,
            top: window.bounds.top,
            width: window.bounds.width,
            height: window.bounds.height,
            working: false,
            editor_found: false,
            editor_has_draft: false,
            context: String::new(),
            error: None,
        },
        None => CodexWindowInfo {
            ok: true,
            found: false,
            handle: 0,
            process_id: 0,
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            working: false,
            editor_found: false,
            editor_has_draft: false,
            context: String::new(),
            error: None,
        },
    })
}

pub(super) fn window_bounds(handle: i64, expected_process_id: u32) -> Option<WindowBounds> {
    let window_id = u32::try_from(handle).ok()?;
    copy_windows(
        K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ABOVE_WINDOW
            | K_CG_WINDOW_LIST_OPTION_INCLUDING_WINDOW
            | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS,
        window_id,
    )
    .ok()?
    .into_iter()
    .find(|window| {
        window.id == window_id
            && window.process_id == expected_process_id
            && is_codex_owner(&window.owner)
    })
    .map(|window| window.bounds)
}

fn copy_windows(options: u32, relative_to_window: CGWindowID) -> Result<Vec<MacWindow>, String> {
    let array = unsafe { CGWindowListCopyWindowInfo(options, relative_to_window) };
    if array.is_null() {
        return Err("macOS 无法读取当前窗口列表".to_owned());
    }
    let _owned_array = OwnedCF(array);
    let count = unsafe { CFArrayGetCount(array) };
    let mut windows = Vec::new();

    for index in 0..count {
        let dictionary = unsafe { CFArrayGetValueAtIndex(array, index) } as CFDictionaryRef;
        if dictionary.is_null() {
            continue;
        }
        let Some(window) = (unsafe { read_window(dictionary) }) else {
            continue;
        };
        windows.push(window);
    }

    Ok(windows)
}

unsafe fn read_window(dictionary: CFDictionaryRef) -> Option<MacWindow> {
    let layer = number_i64(dictionary_value(dictionary, kCGWindowLayer)?)?;
    if layer != 0 {
        return None;
    }
    let alpha = dictionary_value(dictionary, kCGWindowAlpha)
        .and_then(|value| unsafe { number_f64(value) })
        .unwrap_or(1.0);
    if alpha <= 0.01 {
        return None;
    }

    let id = u32::try_from(number_i64(dictionary_value(dictionary, kCGWindowNumber)?)?).ok()?;
    let process_id = u32::try_from(number_i64(dictionary_value(
        dictionary,
        kCGWindowOwnerPID,
    )?)?)
    .ok()?;
    let owner = cf_string(dictionary_value(dictionary, kCGWindowOwnerName)?)?;
    let bounds_value = dictionary_value(dictionary, kCGWindowBounds)? as CFDictionaryRef;
    let mut rect = CGRect::default();
    if CGRectMakeWithDictionaryRepresentation(bounds_value, &mut rect) == 0 {
        return None;
    }
    if !rect.origin.x.is_finite()
        || !rect.origin.y.is_finite()
        || !rect.size.width.is_finite()
        || !rect.size.height.is_finite()
        || rect.size.width < 320.0
        || rect.size.height < 240.0
    {
        return None;
    }

    Some(MacWindow {
        id,
        process_id,
        owner,
        bounds: WindowBounds {
            left: rect.origin.x.round() as i32,
            top: rect.origin.y.round() as i32,
            width: rect.size.width.round() as u32,
            height: rect.size.height.round() as u32,
        },
    })
}

unsafe fn dictionary_value(dictionary: CFDictionaryRef, key: CFStringRef) -> Option<*const c_void> {
    let value = CFDictionaryGetValue(dictionary, key);
    (!value.is_null()).then_some(value)
}

unsafe fn number_i64(number: *const c_void) -> Option<i64> {
    let mut value = 0_i64;
    CFNumberGetValue(
        number as CFNumberRef,
        K_CF_NUMBER_SINT64_TYPE,
        (&mut value as *mut i64).cast(),
    )
    .then_some(value)
}

unsafe fn number_f64(number: *const c_void) -> Option<f64> {
    let mut value = 0_f64;
    CFNumberGetValue(
        number as CFNumberRef,
        K_CF_NUMBER_FLOAT64_TYPE,
        (&mut value as *mut f64).cast(),
    )
    .then_some(value)
}

unsafe fn cf_string(string: *const c_void) -> Option<String> {
    let string = string as CFStringRef;
    let direct = CFStringGetCStringPtr(string, K_CF_STRING_ENCODING_UTF8);
    if !direct.is_null() {
        return CStr::from_ptr(direct).to_str().ok().map(ToOwned::to_owned);
    }

    let length = CFStringGetLength(string);
    let capacity =
        CFStringGetMaximumSizeForEncoding(length, K_CF_STRING_ENCODING_UTF8).checked_add(1)?;
    let mut buffer = vec![0_u8; usize::try_from(capacity).ok()?];
    if CFStringGetCString(
        string,
        buffer.as_mut_ptr().cast(),
        capacity,
        K_CF_STRING_ENCODING_UTF8,
    ) == 0
    {
        return None;
    }
    CStr::from_ptr(buffer.as_ptr().cast())
        .to_str()
        .ok()
        .map(ToOwned::to_owned)
}

fn is_codex_owner(owner: &str) -> bool {
    matches!(
        owner.trim().to_ascii_lowercase().as_str(),
        "codex" | "chatgpt"
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn recognizes_supported_mac_app_names_without_partial_matches() {
        assert!(super::is_codex_owner("Codex"));
        assert!(super::is_codex_owner(" ChatGPT "));
        assert!(!super::is_codex_owner("VibeKarma"));
        assert!(!super::is_codex_owner("Codex Helper"));
    }
}
