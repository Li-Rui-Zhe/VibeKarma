use std::os::windows::process::CommandExt as StdCommandExt;
use std::{collections::HashMap, ffi::OsString, path::PathBuf};

use tokio::process::Command;
use windows::{core::HSTRING, Management::Deployment::PackageManager};

use super::resolver::{candidates_on_path, LaunchKind, ResolvedCodex};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CLI_NAMES: [&str; 3] = ["codex.exe", "codex.cmd", "codex.bat"];
const CODEX_PACKAGE_FAMILIES: [&str; 1] = ["OpenAI.Codex_2p2nqsd0c76g0"];

pub(super) fn external_candidates() -> Vec<PathBuf> {
    let environment = std::env::vars_os().collect::<HashMap<_, _>>();
    external_candidates_from(&environment)
}

pub(super) fn desktop_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for root in package_install_locations() {
        candidates.extend([
            root.join("app/resources/codex.exe"),
            root.join("resources/codex.exe"),
        ]);
    }

    let environment = std::env::vars_os().collect::<HashMap<_, _>>();
    if let Some(local_app_data) = environment.get(&OsString::from("LOCALAPPDATA")) {
        let root = PathBuf::from(local_app_data);
        candidates.extend([
            root.join("Programs/Codex/resources/codex.exe"),
            root.join("Programs/ChatGPT/resources/codex.exe"),
        ]);
    }
    candidates
}

pub(super) fn build_command(
    resolved: &ResolvedCodex,
    args: &[OsString],
) -> Result<Command, String> {
    match resolved.launch_kind {
        LaunchKind::Direct => {
            let mut command = Command::new(&resolved.path);
            command.args(args).creation_flags(CREATE_NO_WINDOW);
            Ok(command)
        }
        LaunchKind::Batch => {
            let command_line = batch_command_line(&resolved.path, args)?;
            let mut command = Command::new("cmd.exe");
            command.arg("/d").arg("/v:off").arg("/s").arg("/c");
            command.as_std_mut().raw_arg(command_line);
            command.creation_flags(CREATE_NO_WINDOW);
            Ok(command)
        }
    }
}

fn external_candidates_from(environment: &HashMap<OsString, OsString>) -> Vec<PathBuf> {
    let mut candidates = candidates_on_path(&CLI_NAMES);
    let mut add_directory = |directory: PathBuf| {
        candidates.extend(CLI_NAMES.map(|name| directory.join(name)));
    };

    for variable in ["PNPM_HOME", "NPM_CONFIG_PREFIX"] {
        if let Some(value) = environment.get(&OsString::from(variable)) {
            add_directory(PathBuf::from(value));
        }
    }
    if let Some(app_data) = environment.get(&OsString::from("APPDATA")) {
        add_directory(PathBuf::from(app_data).join("npm"));
    }
    if let Some(local_app_data) = environment.get(&OsString::from("LOCALAPPDATA")) {
        let root = PathBuf::from(local_app_data);
        add_directory(root.join("pnpm"));
        add_directory(root.join("Volta/bin"));
    }
    if let Some(user_profile) = environment.get(&OsString::from("USERPROFILE")) {
        let root = PathBuf::from(user_profile);
        add_directory(root.join(".local/bin"));
        add_directory(root.join(".bun/bin"));
    }
    candidates
}

fn package_install_locations() -> Vec<PathBuf> {
    let Ok(manager) = PackageManager::new() else {
        return Vec::new();
    };
    let mut locations = Vec::new();
    for family in CODEX_PACKAGE_FAMILIES {
        let Ok(packages) = manager.FindPackagesByPackageFamilyName(&HSTRING::from(family)) else {
            continue;
        };
        for package in packages {
            let Ok(folder) = package.InstalledLocation() else {
                continue;
            };
            let Ok(path) = folder.Path() else {
                continue;
            };
            locations.push(PathBuf::from(path.to_string()));
        }
    }
    locations
}

fn batch_command_line(executable: &std::path::Path, args: &[OsString]) -> Result<String, String> {
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(cmd_quote(executable.as_os_str())?);
    for arg in args {
        parts.push(cmd_quote(arg)?);
    }
    Ok(format!("\"{}\"", parts.join(" ")))
}

fn cmd_quote(value: &std::ffi::OsStr) -> Result<String, String> {
    let value = value.to_string_lossy();
    if value
        .chars()
        .any(|character| matches!(character, '\0' | '\n' | '\r' | '"'))
    {
        return Err("Codex CLI 命令参数包含 Windows cmd.exe 无法安全处理的字符".to_owned());
    }
    Ok(format!("\"{}\"", value.replace('%', "^%")))
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, ffi::OsString, path::PathBuf};

    use super::{batch_command_line, external_candidates_from};

    #[test]
    fn common_windows_install_directories_are_discovered() {
        let environment = HashMap::from([
            (OsString::from("PATH"), OsString::new()),
            (
                OsString::from("APPDATA"),
                OsString::from(r"C:\Users\Rick\AppData\Roaming"),
            ),
            (
                OsString::from("LOCALAPPDATA"),
                OsString::from(r"C:\Users\Rick\AppData\Local"),
            ),
            (
                OsString::from("USERPROFILE"),
                OsString::from(r"C:\Users\Rick"),
            ),
        ]);
        let candidates = external_candidates_from(&environment);
        assert!(candidates.contains(&PathBuf::from(
            r"C:\Users\Rick\AppData\Roaming\npm\codex.cmd"
        )));
        assert!(candidates.contains(&PathBuf::from(
            r"C:\Users\Rick\AppData\Local\pnpm\codex.cmd"
        )));
        assert!(candidates.contains(&PathBuf::from(r"C:\Users\Rick\.bun\bin\codex.exe")));
    }

    #[test]
    fn batch_command_quotes_paths_and_disables_percent_expansion() {
        let command = batch_command_line(
            &PathBuf::from(r"C:\Users\Rick Name\npm\codex.cmd"),
            &[OsString::from("-C"), OsString::from(r"D:\100% work")],
        )
        .expect("batch command should be safe");
        assert!(command.contains(r#""C:\Users\Rick Name\npm\codex.cmd""#));
        assert!(command.contains(r#""D:\100^% work""#));
    }

    #[test]
    fn desktop_package_discovery_never_panics() {
        let _ = super::desktop_candidates();
    }
}
