//! Bounded, read-only traversal shared by the macOS AX reader and fixture tests.
use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

pub(super) const MAX_CONTEXT_CHARS: usize = 12_000;
pub(super) fn matches_window(frame: [f64; 4], expected: [f64; 4]) -> bool {
    frame
        .into_iter()
        .zip(expected)
        .all(|(actual, expected)| actual.is_finite() && (actual - expected).abs() <= 2.0)
}
const MAX_NODES: usize = 2_000;
const MAX_DEPTH: usize = 48;
const READ_TIMEOUT: Duration = Duration::from_secs(3);

pub(super) struct NodeData<N> {
    pub role: String,
    pub subrole: String,
    pub hidden: bool,
    pub text: Option<String>,
    pub children: Vec<N>,
}

pub(super) trait ContextTree {
    type Node;
    fn read(&self, node: &Self::Node, budget: &ReadBudget) -> Result<NodeData<Self::Node>, String>;
}

pub(super) struct ReadBudget {
    deadline: Instant,
    remaining_nodes: usize,
}

impl ReadBudget {
    pub fn new() -> Self {
        Self {
            deadline: Instant::now() + READ_TIMEOUT,
            remaining_nodes: MAX_NODES,
        }
    }

    pub fn check(&self) -> Result<(), String> {
        if Instant::now() >= self.deadline {
            Err("读取 Codex 聊天内容超时，本次日记将使用反馈原因和近期日记。".into())
        } else {
            Ok(())
        }
    }

    pub fn remaining_nodes(&self) -> usize {
        self.remaining_nodes
    }
}

#[derive(Default)]
struct RecentText {
    lines: VecDeque<String>,
    chars: usize,
}

impl RecentText {
    fn push(&mut self, text: &str) {
        let text = text.replace(['\0', '\u{fffc}'], "");
        let text = text.trim();
        if text.is_empty() || self.lines.back().is_some_and(|last| last == text) {
            return;
        }
        let count = text.chars().count();
        let text = text
            .chars()
            .skip(count.saturating_sub(MAX_CONTEXT_CHARS))
            .collect::<String>();
        self.chars += text.chars().count() + 1;
        self.lines.push_back(text);
        while self.lines.len() > 1 && self.chars > MAX_CONTEXT_CHARS {
            self.chars -= self.lines.pop_front().unwrap().chars().count() + 1;
        }
    }

    fn finish(self) -> String {
        self.lines.into_iter().collect::<Vec<_>>().join("\n")
    }
}

pub(super) fn skip_subtree(role: &str, subrole: &str, hidden: bool) -> bool {
    hidden
        || matches!(
            role,
            "AXTextField" | "AXTextArea" | "AXComboBox" | "AXButton" | "AXMenu" | "AXMenuBar"
        )
        || subrole == "AXSecureTextField"
}

pub(super) fn read_context<T: ContextTree>(
    tree: &T,
    root: T::Node,
    mut budget: ReadBudget,
) -> Result<String, String> {
    let mut stack = vec![(root, 0, false)];
    let mut web_text = RecentText::default();
    let mut native_text = RecentText::default();
    let mut has_document = false;
    while let Some((node, depth, in_document)) = stack.pop() {
        budget.check()?;
        if budget.remaining_nodes == 0 || depth > MAX_DEPTH {
            return Err(
                "Codex 界面内容过多，未能完整读取；本次日记将使用反馈原因和近期日记。".into(),
            );
        }
        budget.remaining_nodes -= 1;
        let data = tree.read(&node, &budget)?;
        if skip_subtree(&data.role, &data.subrole, data.hidden) {
            continue;
        }
        let in_document = in_document || matches!(data.role.as_str(), "AXWebArea" | "AXDocument");
        has_document |= in_document;
        if data.role == "AXStaticText" {
            if let Some(text) = data.text {
                if in_document {
                    web_text.push(&text);
                } else {
                    native_text.push(&text);
                }
            }
        }
        for child in data.children.into_iter().rev() {
            stack.push((child, depth + 1, in_document));
        }
        if stack.len() > budget.remaining_nodes {
            return Err(
                "Codex 界面内容过多，未能完整读取；本次日记将使用反馈原因和近期日记。".into(),
            );
        }
    }
    budget.check()?;
    // Once a document exists, never substitute unrelated native sidebar labels.
    let text = if has_document {
        web_text.finish()
    } else {
        native_text.finish()
    };
    if text.is_empty() {
        Err("Codex 暂未提供可读取的聊天文本。请打开会话后重新检测；本次日记将使用反馈原因和近期日记。".into())
    } else {
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Node {
        role: &'static str,
        subrole: &'static str,
        hidden: bool,
        text: &'static str,
        children: Vec<usize>,
    }
    struct Tree(Vec<Node>);
    impl ContextTree for Tree {
        type Node = usize;
        fn read(&self, node: &usize, budget: &ReadBudget) -> Result<NodeData<usize>, String> {
            let node = &self.0[*node];
            if node.children.len() > budget.remaining_nodes() {
                return Err("节点数量超过限制".into());
            }
            Ok(NodeData {
                role: node.role.into(),
                subrole: node.subrole.into(),
                hidden: node.hidden,
                text: Some(node.text.into()),
                children: node.children.clone(),
            })
        }
    }
    fn node(role: &'static str, text: &'static str, children: Vec<usize>) -> Node {
        Node {
            role,
            subrole: "",
            hidden: false,
            text,
            children,
        }
    }

    #[test]
    fn window_matching_handles_retina_points_and_rejects_other_windows() {
        assert!(matches_window(
            [-100.5, 40.2, 900.4, 700.0],
            [-101.0, 40.0, 900.0, 700.0]
        ));
        assert!(!matches_window(
            [20.0, 40.0, 900.0, 700.0],
            [-101.0, 40.0, 900.0, 700.0]
        ));
        assert!(!matches_window(
            [f64::NAN, 40.0, 900.0, 700.0],
            [-101.0, 40.0, 900.0, 700.0]
        ));
        assert!(!matches_window(
            [0.0, 0.0, 1800.0, 1400.0],
            [0.0, 0.0, 900.0, 700.0]
        ));
    }

    #[test]
    fn document_text_excludes_sidebar_drafts_passwords_and_hidden_subtrees() {
        let mut tree = Tree(vec![
            node("AXWindow", "", vec![1, 2, 5, 7, 9]),
            node("AXStaticText", "侧栏项目", vec![]),
            node("AXWebArea", "", vec![3, 4]),
            node("AXStaticText", "用户：改错文件了", vec![]),
            node("AXStaticText", "Codex：我会修正", vec![]),
            node("AXTextArea", "未发送草稿", vec![6]),
            node("AXStaticText", "草稿子节点", vec![]),
            node("AXGroup", "", vec![8]),
            node("AXStaticText", "密码", vec![]),
            node("AXGroup", "", vec![10]),
            node("AXStaticText", "隐藏内容", vec![]),
        ]);
        tree.0[7].subrole = "AXSecureTextField";
        tree.0[9].hidden = true;
        assert_eq!(
            read_context(&tree, 0, ReadBudget::new()).unwrap(),
            "用户：改错文件了\nCodex：我会修正"
        );
    }

    #[test]
    fn empty_document_does_not_fall_back_to_sidebar_text() {
        let tree = Tree(vec![
            node("AXWindow", "", vec![1, 2]),
            node("AXStaticText", "设置", vec![]),
            node("AXWebArea", "", vec![]),
        ]);
        assert!(read_context(&tree, 0, ReadBudget::new()).is_err());
    }

    #[test]
    fn native_text_is_supported_and_repeated_messages_keep_their_order() {
        let tree = Tree(vec![
            node("AXWindow", "", vec![1, 2, 3, 4]),
            node("AXStaticText", "同一句", vec![]),
            node("AXStaticText", "同一句", vec![]),
            node("AXStaticText", "回应", vec![]),
            node("AXStaticText", "同一句", vec![]),
        ]);
        assert_eq!(
            read_context(&tree, 0, ReadBudget::new()).unwrap(),
            "同一句\n回应\n同一句"
        );
    }

    #[test]
    fn cyclic_deep_and_oversized_trees_stop_without_returning_partial_text() {
        let cycle = Tree(vec![node("AXGroup", "", vec![0])]);
        assert!(read_context(&cycle, 0, ReadBudget::new()).is_err());
        let wide = Tree(vec![
            node("AXWindow", "", vec![1; MAX_NODES + 1]),
            node("AXStaticText", "旧内容", vec![]),
        ]);
        assert!(read_context(&wide, 0, ReadBudget::new()).is_err());
        let mut budget = ReadBudget::new();
        budget.deadline = Instant::now();
        assert!(read_context(&wide, 0, budget).unwrap_err().contains("超时"));
    }

    #[test]
    fn recent_text_is_unicode_safe_and_bounded() {
        let mut text = RecentText::default();
        text.push("最旧内容");
        text.push(&"中🦀".repeat(MAX_CONTEXT_CHARS));
        let result = text.finish();
        assert_eq!(result.chars().count(), MAX_CONTEXT_CHARS);
        assert!(result.ends_with("中🦀"));
        assert!(!result.contains("最旧"));
    }

    #[test]
    fn failure_after_some_text_discards_the_partial_context() {
        struct Failing;
        impl ContextTree for Failing {
            type Node = usize;
            fn read(&self, node: &usize, _: &ReadBudget) -> Result<NodeData<usize>, String> {
                if *node == 1 {
                    return Err("目标窗口已经变化".into());
                }
                Ok(NodeData {
                    role: "AXStaticText".into(),
                    subrole: String::new(),
                    hidden: false,
                    text: Some("不应使用的部分内容".into()),
                    children: vec![1],
                })
            }
        }
        assert!(read_context(&Failing, 0, ReadBudget::new()).is_err());
    }
}
