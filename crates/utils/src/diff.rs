use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};
use ts_rs::TS;

// Structs compatable with props: https://github.com/MrWangJustToDo/git-diff-view

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffDetails {
    pub file_name: Option<String>,
    pub content: Option<String>,
}

// Worktree diffs for the diffs tab: minimal, no hunks, optional full contents
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    pub change: DiffChangeKind,
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum DiffChangeKind {
    Added,
    Deleted,
    Modified,
    Renamed,
    Copied,
    PermissionChange,
}

// ==============================
// Unified diff utility functions
// ==============================

/// Converts a replace diff to a unified diff hunk without the hunk header.
/// The hunk returned will have valid hunk, and diff lines.
pub fn create_unified_diff_hunk(old: &str, new: &str) -> String {
    // normalize ending line feed to optimize diff output
    let mut old = old.to_string();
    let mut new = new.to_string();
    if !old.ends_with('\n') {
        old.push('\n');
    }
    if !new.ends_with('\n') {
        new.push('\n');
    }

    let diff = TextDiff::from_lines(&old, &new);

    let mut out = String::new();

    // We need a valud hunk header. assume lines are 0. but - + count will be correct.

    let old_count = diff.old_slices().len();
    let new_count = diff.new_slices().len();

    out.push_str(&format!("@@ -1,{old_count} +1,{new_count} @@\n"));

    for change in diff.iter_all_changes() {
        let sign = match change.tag() {
            ChangeTag::Equal => ' ',
            ChangeTag::Delete => '-',
            ChangeTag::Insert => '+',
        };
        let val = change.value();
        out.push(sign);
        out.push_str(val);
    }

    out
}

/// Creates a full unified diff with the file path in the header.
pub fn create_unified_diff(file_path: &str, old: &str, new: &str) -> String {
    let mut out = String::new();
    out.push_str(format!("--- a/{file_path}\n+++ b/{file_path}\n").as_str());
    out.push_str(&create_unified_diff_hunk(old, new));
    out
}

/// Extracts unified diff hunks from a string containing a full unified diff.
/// Tolerates non-diff lines and missing `@@`` hunk headers.
pub fn extract_unified_diff_hunks(unified_diff: &str) -> Vec<String> {
    let lines = unified_diff.split_inclusive('\n').collect::<Vec<_>>();

    if !lines.iter().any(|l| l.starts_with("@@")) {
        // No @@ hunk headers: treat as a single hunk
        let hunk = lines
            .iter()
            .copied()
            .filter(|line| line.starts_with([' ', '+', '-']))
            .collect::<String>();

        let old_count = lines
            .iter()
            .filter(|line| line.starts_with(['-', ' ']))
            .count();
        let new_count = lines
            .iter()
            .filter(|line| line.starts_with(['+', ' ']))
            .count();

        return if hunk.is_empty() {
            vec![]
        } else {
            vec![format!("@@ -1,{old_count} +1,{new_count} @@\n{hunk}")]
        };
    }

    let mut hunks = vec![];
    let mut current_hunk: Option<String> = None;

    // Collect hunks starting with @@ headers
    for line in lines {
        if line.starts_with("@@") {
            // new hunk starts
            if let Some(hunk) = current_hunk.take() {
                // flush current hunk
                if !hunk.is_empty() {
                    hunks.push(hunk);
                }
            }
            current_hunk = Some(line.to_string());
        } else if let Some(ref mut hunk) = current_hunk {
            if line.starts_with([' ', '+', '-']) {
                // hunk content
                hunk.push_str(line);
            } else {
                // unkown line, flush current hunk
                if !hunk.is_empty() {
                    hunks.push(hunk.clone());
                }
                current_hunk = None;
            }
        }
    }
    // we have reached the end. flush the last hunk if it exists
    if let Some(hunk) = current_hunk
        && !hunk.is_empty()
    {
        hunks.push(hunk);
    }

    // Fix hunk headers if they are empty @@\n
    hunks = fix_hunk_headers(hunks);

    hunks
}

// Helper function to ensure valid hunk headers
fn fix_hunk_headers(hunks: Vec<String>) -> Vec<String> {
    if hunks.is_empty() {
        return hunks;
    }

    let mut new_hunks = Vec::new();
    // if hunk header is empty @@\n, ten we need to replace it with a valid header
    for hunk in hunks {
        let mut lines = hunk
            .split_inclusive('\n')
            .map(str::to_string)
            .collect::<Vec<_>>();
        if lines.len() < 2 {
            // empty hunk, skip
            continue;
        }

        let header = &lines[0];
        if !header.starts_with("@@") {
            // no header, skip
            continue;
        }

        if header.trim() == "@@" {
            // empty header, replace with a valid one
            lines.remove(0);
            let old_count = lines
                .iter()
                .filter(|line| line.starts_with(['-', ' ']))
                .count();
            let new_count = lines
                .iter()
                .filter(|line| line.starts_with(['+', ' ']))
                .count();
            let new_header = format!("@@ -1,{old_count} +1,{new_count} @@");
            lines.insert(0, new_header);
            new_hunks.push(lines.join(""));
        } else {
            // valid header, keep as is
            new_hunks.push(hunk);
        }
    }

    new_hunks
}

/// Creates a full unified diff with the file path in the header,
pub fn concatenate_diff_hunks(file_path: &str, hunks: &[String]) -> String {
    let mut unified_diff = String::new();

    let header = format!("--- a/{file_path}\n+++ b/{file_path}\n");

    unified_diff.push_str(&header);

    if !hunks.is_empty() {
        let lines = hunks
            .iter()
            .flat_map(|hunk| hunk.lines())
            .filter(|line| line.starts_with("@@ ") || line.starts_with([' ', '+', '-']))
            .collect::<Vec<_>>();
        unified_diff.push_str(lines.join("\n").as_str());
        if !unified_diff.ends_with('\n') {
            unified_diff.push('\n');
        }
    }

    unified_diff
}
