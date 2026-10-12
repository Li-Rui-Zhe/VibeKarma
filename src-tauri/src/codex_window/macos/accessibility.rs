//! macOS AX access stays on a blocking worker and is limited to one matched window.
//! Only AXManualAccessibility is set (Electron's documented tree toggle); no UI
//! actions, clipboard access, typing or document edits are performed.
use std::{
    ffi::{c_int, c_void},
    ptr,
};

use super::super::context_reader::{self, ContextTree, NodeData, ReadBudget, MAX_CONTEXT_CHARS};
use super::{CGPoint, CGSize, WindowBounds};

type CFRef = *const c_void;
type CFIndex = isize;
type AXError = i32;
const UTF8: u32 = 0x0800_0100;
const AX_SUCCESS: AXError = 0;
const AX_ATTRIBUTE_UNSUPPORTED: AXError = -25205;
const AX_NO_VALUE: AXError = -25212;
const AX_API_DISABLED: AXError = -25211;
const AX_POINT: u32 = 1;
const AX_SIZE: u32 = 2;
const PERMISSION_HELP: &str = "未获得读取聊天内容的辅助功能权限。请在系统设置 → 隐私与安全性 → 辅助功能中允许 VibeKarma，再重新检测；奖惩仍可使用。";

#[repr(C)]
struct CFRange {
    location: CFIndex,
    length: CFIndex,
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFBooleanTrue: CFRef;
    fn CFRelease(value: CFRef);
    fn CFRetain(value: CFRef) -> CFRef;
    fn CFGetTypeID(value: CFRef) -> usize;
    fn CFArrayGetTypeID() -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFBooleanGetTypeID() -> usize;
    fn CFBooleanGetValue(value: CFRef) -> u8;
    fn CFArrayGetCount(array: CFRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(array: CFRef, index: CFIndex) -> CFRef;
    fn CFStringCreateWithBytes(
        allocator: CFRef,
        bytes: *const u8,
        count: CFIndex,
        encoding: u32,
        external: u8,
    ) -> CFRef;
    fn CFStringGetLength(string: CFRef) -> CFIndex;
    fn CFStringGetCharacters(string: CFRef, range: CFRange, buffer: *mut u16);
    fn CFDictionaryCreate(
        allocator: CFRef,
        keys: *const CFRef,
        values: *const CFRef,
        count: CFIndex,
        key_callbacks: CFRef,
        value_callbacks: CFRef,
    ) -> CFRef;
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    static kAXTrustedCheckOptionPrompt: CFRef;
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: CFRef) -> u8;
    fn AXUIElementCreateApplication(pid: c_int) -> CFRef;
    fn AXUIElementGetTypeID() -> usize;
    fn AXUIElementSetMessagingTimeout(element: CFRef, seconds: f32) -> AXError;
    fn AXUIElementCopyAttributeValue(
        element: CFRef,
        attribute: CFRef,
        value: *mut CFRef,
    ) -> AXError;
    fn AXUIElementGetAttributeValueCount(
        element: CFRef,
        attribute: CFRef,
        count: *mut CFIndex,
    ) -> AXError;
    fn AXUIElementCopyAttributeValues(
        element: CFRef,
        attribute: CFRef,
        index: CFIndex,
        max: CFIndex,
        values: *mut CFRef,
    ) -> AXError;
    fn AXUIElementSetAttributeValue(element: CFRef, attribute: CFRef, value: CFRef) -> AXError;
    fn AXValueGetTypeID() -> usize;
    fn AXValueGetType(value: CFRef) -> u32;
    fn AXValueGetValue(value: CFRef, kind: u32, result: *mut c_void) -> u8;
}

struct OwnedCF(CFRef);
impl OwnedCF {
    fn new(value: CFRef) -> Result<Self, String> {
        if value.is_null() {
            Err("macOS 未返回辅助功能对象，本次未读取聊天内容。".into())
        } else {
            Ok(Self(value))
        }
    }
}
impl Drop for OwnedCF {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) };
    }
}

fn cf_string(text: &str) -> Result<OwnedCF, String> {
    OwnedCF::new(unsafe {
        CFStringCreateWithBytes(ptr::null(), text.as_ptr(), text.len() as CFIndex, UTF8, 0)
    })
}

fn string_value(value: &OwnedCF, max_units: usize) -> Option<String> {
    unsafe {
        if CFGetTypeID(value.0) != CFStringGetTypeID() {
            return None;
        }
        let length = CFStringGetLength(value.0);
        let count = usize::try_from(length).ok()?.min(max_units);
        let mut units = vec![0_u16; count];
        CFStringGetCharacters(
            value.0,
            CFRange {
                location: length - count as CFIndex,
                length: count as CFIndex,
            },
            units.as_mut_ptr(),
        );
        Some(String::from_utf16_lossy(&units))
    }
}

fn ax_error(code: AXError) -> String {
    if code == AX_API_DISABLED {
        PERMISSION_HELP.into()
    } else {
        format!("Codex 聊天内容暂时无法读取（辅助功能错误 {code}）。请重新检测；本次日记将使用反馈原因和近期日记。")
    }
}

/// This is only called by the user's explicit authorization button, never at startup.
pub(super) fn request_accessibility() -> Result<(), String> {
    unsafe {
        // Both keys and values are static framework constants, so null callbacks
        // are sufficient for this short-lived dictionary (nothing to retain).
        let key = kAXTrustedCheckOptionPrompt;
        let value = kCFBooleanTrue;
        let options = OwnedCF::new(CFDictionaryCreate(
            ptr::null(),
            &key,
            &value,
            1,
            ptr::null(),
            ptr::null(),
        ))?;
        let _ = AXIsProcessTrustedWithOptions(options.0);
    }
    Ok(())
}

struct AxReader;
impl AxReader {
    fn prepare(&self, node: &OwnedCF, budget: &ReadBudget) -> Result<(), String> {
        budget.check()?;
        // Apple specifies that the timeout applies only to this exact AX object,
        // not to its children or even other references to an equal object.
        let code = unsafe { AXUIElementSetMessagingTimeout(node.0, 0.15) };
        if code != AX_SUCCESS {
            return Err(ax_error(code));
        }
        Ok(())
    }

    fn attribute(
        &self,
        node: &OwnedCF,
        name: &str,
        budget: &ReadBudget,
    ) -> Result<Option<OwnedCF>, String> {
        self.prepare(node, budget)?;
        let attribute = cf_string(name)?;
        let mut value = ptr::null();
        let code = unsafe { AXUIElementCopyAttributeValue(node.0, attribute.0, &mut value) };
        if code == AX_SUCCESS {
            return OwnedCF::new(value).map(Some);
        }
        if !value.is_null() {
            drop(OwnedCF(value));
        }
        if matches!(code, AX_ATTRIBUTE_UNSUPPORTED | AX_NO_VALUE) {
            Ok(None)
        } else {
            Err(ax_error(code))
        }
    }

    fn text(
        &self,
        node: &OwnedCF,
        name: &str,
        max: usize,
        budget: &ReadBudget,
    ) -> Result<Option<String>, String> {
        Ok(self
            .attribute(node, name, budget)?
            .as_ref()
            .and_then(|value| string_value(value, max)))
    }

    fn hidden(&self, node: &OwnedCF, budget: &ReadBudget) -> Result<bool, String> {
        let value = self.attribute(node, "AXHidden", budget)?;
        Ok(value.is_some_and(|value| unsafe {
            CFGetTypeID(value.0) == CFBooleanGetTypeID() && CFBooleanGetValue(value.0) != 0
        }))
    }

    fn children(
        &self,
        node: &OwnedCF,
        name: &str,
        max: usize,
        budget: &ReadBudget,
    ) -> Result<Vec<OwnedCF>, String> {
        self.prepare(node, budget)?;
        let attribute = cf_string(name)?;
        let mut count = 0;
        let code = unsafe { AXUIElementGetAttributeValueCount(node.0, attribute.0, &mut count) };
        if matches!(code, AX_ATTRIBUTE_UNSUPPORTED | AX_NO_VALUE) {
            return Ok(vec![]);
        }
        if code != AX_SUCCESS {
            return Err(ax_error(code));
        }
        let count =
            usize::try_from(count).map_err(|_| "辅助功能返回无效的子节点数量".to_owned())?;
        if count > max {
            return Err(
                "Codex 界面内容过多，未能完整读取；本次日记将使用反馈原因和近期日记。".into(),
            );
        }
        if count == 0 {
            return Ok(vec![]);
        }
        budget.check()?;
        let mut array = ptr::null();
        let code = unsafe {
            AXUIElementCopyAttributeValues(node.0, attribute.0, 0, count as CFIndex, &mut array)
        };
        if code != AX_SUCCESS {
            if !array.is_null() {
                drop(OwnedCF(array));
            }
            return Err(ax_error(code));
        }
        let array = OwnedCF::new(array)?;
        unsafe {
            if CFGetTypeID(array.0) != CFArrayGetTypeID() {
                return Err("辅助功能返回无效的子节点列表".into());
            }
            let actual = CFArrayGetCount(array.0);
            if actual < 0 || actual as usize > max {
                return Err("辅助功能返回过多子节点".into());
            }
            let mut nodes = Vec::new();
            for index in 0..actual {
                let element = CFArrayGetValueAtIndex(array.0, index);
                if element.is_null() || CFGetTypeID(element) != AXUIElementGetTypeID() {
                    continue;
                }
                nodes.push(OwnedCF::new(CFRetain(element))?);
            }
            Ok(nodes)
        }
    }

    fn window_frame(
        &self,
        node: &OwnedCF,
        budget: &ReadBudget,
    ) -> Result<Option<[f64; 4]>, String> {
        let position = self.attribute(node, "AXPosition", budget)?;
        let size = self.attribute(node, "AXSize", budget)?;
        let (Some(position), Some(size)) = (position, size) else {
            return Ok(None);
        };
        unsafe {
            if CFGetTypeID(position.0) != AXValueGetTypeID()
                || AXValueGetType(position.0) != AX_POINT
                || CFGetTypeID(size.0) != AXValueGetTypeID()
                || AXValueGetType(size.0) != AX_SIZE
            {
                return Ok(None);
            }
            let mut point = CGPoint::default();
            let mut size_value = CGSize::default();
            if AXValueGetValue(position.0, AX_POINT, (&mut point as *mut CGPoint).cast()) == 0
                || AXValueGetValue(size.0, AX_SIZE, (&mut size_value as *mut CGSize).cast()) == 0
            {
                return Ok(None);
            }
            Ok(Some([
                point.x,
                point.y,
                size_value.width,
                size_value.height,
            ]))
        }
    }
}

impl ContextTree for AxReader {
    type Node = OwnedCF;
    fn read(&self, node: &OwnedCF, budget: &ReadBudget) -> Result<NodeData<OwnedCF>, String> {
        let role = self.text(node, "AXRole", 128, budget)?.unwrap_or_default();
        let subrole = self
            .text(node, "AXSubrole", 128, budget)?
            .unwrap_or_default();
        let hidden = self.hidden(node, budget)?;
        if context_reader::skip_subtree(&role, &subrole, hidden) {
            return Ok(NodeData {
                role,
                subrole,
                hidden,
                text: None,
                children: vec![],
            });
        }
        let mut text = None;
        if role == "AXStaticText" {
            for name in ["AXValue", "AXTitle", "AXDescription"] {
                text = self.text(node, name, MAX_CONTEXT_CHARS * 2, budget)?;
                if text.as_ref().is_some_and(|value| !value.trim().is_empty()) {
                    break;
                }
            }
        }
        let children = self.children(node, "AXChildren", budget.remaining_nodes(), budget)?;
        Ok(NodeData {
            role,
            subrole,
            hidden,
            text,
            children,
        })
    }
}

pub(super) fn read_window_context(pid: u32, bounds: WindowBounds) -> Result<String, String> {
    if unsafe { AXIsProcessTrusted() } == 0 {
        return Err(PERMISSION_HELP.into());
    }
    let pid = c_int::try_from(pid).map_err(|_| "Codex 进程编号无效".to_owned())?;
    let app = OwnedCF::new(unsafe { AXUIElementCreateApplication(pid) })?;
    let code = unsafe { AXUIElementSetMessagingTimeout(app.0, 0.15) };
    if code != AX_SUCCESS {
        return Err(ax_error(code));
    }
    let budget = ReadBudget::new();
    // Electron documents this attribute as the way a native accessibility client
    // exposes its web tree. Unsupported native apps can still expose AXStaticText.
    let manual = cf_string("AXManualAccessibility")?;
    let _ = unsafe { AXUIElementSetAttributeValue(app.0, manual.0, kCFBooleanTrue) };
    let reader = AxReader;
    let windows = reader.children(&app, "AXWindows", 64, &budget)?;
    let expected = [
        bounds.left as f64,
        bounds.top as f64,
        bounds.width as f64,
        bounds.height as f64,
    ];
    let mut matched = None;
    for window in windows {
        if reader
            .window_frame(&window, &budget)?
            .is_some_and(|frame| context_reader::matches_window(frame, expected))
        {
            if matched.is_some() {
                return Err("存在多个位置相同的 Codex 窗口，无法安全确定当前会话。请关闭重叠窗口后重新检测。".into());
            }
            matched = Some(window);
        }
    }
    let window = matched.ok_or_else(|| "Codex 窗口位置或会话已变化，未读取其他窗口。请重新检测；本次日记将使用反馈原因和近期日记。".to_owned())?;
    context_reader::read_context(&reader, window, budget)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn core_foundation_strings_are_type_checked_and_unicode_safe() {
        let value = cf_string("聊天🦀内容").unwrap();
        assert_eq!(string_value(&value, 100).as_deref(), Some("聊天🦀内容"));
        assert_eq!(string_value(&value, 2).as_deref(), Some("内容"));
        let boolean = OwnedCF::new(unsafe { CFRetain(kCFBooleanTrue) }).unwrap();
        assert_eq!(string_value(&boolean, 100), None);
    }

    #[test]
    fn missing_permission_returns_help_without_prompting_or_panicking() {
        if unsafe { AXIsProcessTrusted() } == 0 {
            let result = read_window_context(
                std::process::id(),
                WindowBounds {
                    left: 0,
                    top: 0,
                    width: 400,
                    height: 300,
                },
            );
            assert_eq!(result.unwrap_err(), PERMISSION_HELP);
        }
    }
}
