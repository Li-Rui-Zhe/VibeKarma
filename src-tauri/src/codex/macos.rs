use std::{collections::HashMap, ffi::OsString, path::PathBuf};

use super::resolver::candidates_on_path;

const DESKTOP_BUNDLE_NAMES: [&str; 2] = ["Codex.app", "ChatGPT.app"];

pub(super) fn external_candidates() -> Vec<PathBuf> {
    let environment = std::env::vars_os().collect::<HashMap<_, _>>();
    external_candidates_from(&environment)
}

pub(super) fn desktop_candidates() -> Vec<PathBuf> {
    let environment = std::env::vars_os().collect::<HashMap<_, _>>();
    desktop_candidates_from(&environment)
}

fn external_candidates_from(environment: &HashMap<OsString, OsString>) -> Vec<PathBuf> {
    let mut candidates = candidates_on_path(&["codex"]);
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
    ]);

    if let Some(pnpm_home) = environment.get(&OsString::from("PNPM_HOME")) {
        candidates.push(PathBuf::from(pnpm_home).join("codex"));
    }
    if let Some(npm_prefix) = environment.get(&OsString::from("NPM_CONFIG_PREFIX")) {
        candidates.push(PathBuf::from(npm_prefix).join("bin/codex"));
    }

    if let Some(home) = environment.get(&OsString::from("HOME")).map(PathBuf::from) {
        candidates.extend([
            home.join(".local/bin/codex"),
            home.join(".npm-global/bin/codex"),
            home.join("Library/pnpm/codex"),
            home.join(".bun/bin/codex"),
            home.join(".volta/bin/codex"),
            home.join(".nvm/current/bin/codex"),
        ]);

        if let Ok(versions) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            let mut versioned = versions
                .filter_map(Result::ok)
                .map(|entry| entry.path().join("bin/codex"))
                .collect::<Vec<_>>();
            versioned.sort_by(|left, right| right.cmp(left));
            candidates.extend(versioned);
        }
    }
    candidates
}

fn desktop_candidates_from(environment: &HashMap<OsString, OsString>) -> Vec<PathBuf> {
    let mut applications = vec![PathBuf::from("/Applications")];
    if let Some(home) = environment.get(&OsString::from("HOME")).map(PathBuf::from) {
        applications.push(home.join("Applications"));
    }

    applications
        .into_iter()
        .flat_map(|root| {
            DESKTOP_BUNDLE_NAMES
                .into_iter()
                .map(move |bundle| root.join(bundle).join("Contents/Resources/codex"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, ffi::OsString, path::PathBuf};

    use super::{desktop_candidates_from, external_candidates_from};

    #[test]
    fn runtime_discovery_never_panics() {
        let _ = super::external_candidates();
        let _ = super::desktop_candidates();
    }

    #[test]
    fn common_macos_install_directories_are_discovered() {
        let environment = HashMap::from([
            (OsString::from("PATH"), OsString::new()),
            (OsString::from("HOME"), OsString::from("/Users/rick")),
            (
                OsString::from("NPM_CONFIG_PREFIX"),
                OsString::from("/Users/rick/.npm-global"),
            ),
        ]);
        let candidates = external_candidates_from(&environment);
        assert!(candidates.contains(&PathBuf::from("/opt/homebrew/bin/codex")));
        assert!(candidates.contains(&PathBuf::from("/Users/rick/Library/pnpm/codex")));
        assert!(candidates.contains(&PathBuf::from("/Users/rick/.bun/bin/codex")));
        assert!(candidates.contains(&PathBuf::from("/Users/rick/.npm-global/bin/codex")));
    }

    #[test]
    fn desktop_bundle_is_only_a_fallback_candidate() {
        let environment = HashMap::from([(OsString::from("HOME"), OsString::from("/Users/rick"))]);
        let candidates = desktop_candidates_from(&environment);
        assert_eq!(
            candidates[0],
            PathBuf::from("/Applications/Codex.app/Contents/Resources/codex")
        );
        assert!(candidates.contains(&PathBuf::from(
            "/Users/rick/Applications/ChatGPT.app/Contents/Resources/codex"
        )));
    }
}
