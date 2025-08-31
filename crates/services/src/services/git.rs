use std::{collections::HashMap, path::Path};

use chrono::{DateTime, Utc};
use git2::{
    BranchType, CherrypickOptions, Delta, DiffFindOptions, DiffOptions, Error as GitError,
    FetchOptions, Reference, Remote, Repository, Sort, build::CheckoutBuilder,
};
use regex;
use serde::Serialize;
use thiserror::Error;
use ts_rs::TS;
use utils::diff::{Diff, DiffChangeKind, FileDiffDetails};

// Import for file ranking functionality
use super::file_ranker::FileStat;
use super::git_cli::{ChangeType, GitCli, StatusDiffEntry, StatusDiffOptions};
use crate::services::github_service::GitHubRepoInfo;

#[derive(Debug, Error)]
pub enum GitServiceError {
    #[error(transparent)]
    Git(#[from] GitError),
    #[error(transparent)]
    IoError(#[from] std::io::Error),
    #[error("Invalid repository: {0}")]
    InvalidRepository(String),
    #[error("Branch not found: {0}")]
    BranchNotFound(String),
    #[error("Merge conflicts: {0}")]
    MergeConflicts(String),
    #[error("Branches diverged: {0}")]
    BranchesDiverged(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("{0} has uncommitted changes: {1}")]
    WorktreeDirty(String, String),
    #[error("Invalid file paths: {0}")]
    InvalidFilePaths(String),
    #[error("No GitHub token available.")]
    TokenUnavailable,
}

/// Service for managing Git operations in task execution workflows
#[derive(Clone)]
pub struct GitService {}

#[derive(Debug, Serialize, TS)]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    #[ts(type = "Date")]
    pub last_commit_date: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct HeadInfo {
    pub branch: String,
    pub oid: String,
}

/// Target for diff generation
pub enum DiffTarget<'p> {
    /// Work-in-progress branch checked out in this worktree
    Worktree {
        worktree_path: &'p Path,
        branch_name: &'p str,
        base_branch: &'p str,
    },
    /// Fully committed branch vs base branch
    Branch {
        repo_path: &'p Path,
        branch_name: &'p str,
        base_branch: &'p str,
    },
    /// Specific commit vs base branch
    Commit {
        repo_path: &'p Path,
        commit_sha: &'p str,
    },
}

impl Default for GitService {
    fn default() -> Self {
        Self::new()
    }
}

impl GitService {
    /// Create a new GitService for the given repository path
    pub fn new() -> Self {
        Self {}
    }

    /// Open the repository
    fn open_repo(&self, repo_path: &Path) -> Result<Repository, GitServiceError> {
        Repository::open(repo_path).map_err(GitServiceError::from)
    }

    pub fn default_remote_name(&self, repo: &Repository) -> String {
        if let Ok(repos) = repo.remotes() {
            repos
                .iter()
                .flatten()
                .next()
                .map(|r| r.to_owned())
                .unwrap_or_else(|| "origin".to_string())
        } else {
            "origin".to_string()
        }
    }

    /// Initialize a new git repository with a main branch and initial commit
    pub fn initialize_repo_with_main_branch(
        &self,
        repo_path: &Path,
    ) -> Result<(), GitServiceError> {
        // Create directory if it doesn't exist
        if !repo_path.exists() {
            std::fs::create_dir_all(repo_path)?;
        }

        // Initialize git repository with main branch
        let repo = Repository::init_opts(
            repo_path,
            git2::RepositoryInitOptions::new()
                .initial_head("main")
                .mkdir(true),
        )?;

        // Create initial commit
        self.create_initial_commit(&repo)?;

        Ok(())
    }

    /// Ensure an existing repository has a main branch (for empty repos)
    pub fn ensure_main_branch_exists(&self, repo_path: &Path) -> Result<(), GitServiceError> {
        let repo = self.open_repo(repo_path)?;

        // Only create initial commit if repository is empty
        if repo.is_empty()? {
            self.create_initial_commit(&repo)?;
        }

        Ok(())
    }

    pub fn create_initial_commit(&self, repo: &Repository) -> Result<(), GitServiceError> {
        let signature = repo.signature().unwrap_or_else(|_| {
            // Fallback if no Git config is set
            git2::Signature::now("Vibe Kanban", "noreply@vibekanban.com")
                .expect("Failed to create fallback signature")
        });

        let tree_id = {
            let tree_builder = repo.treebuilder(None)?;
            tree_builder.write()?
        };
        let tree = repo.find_tree(tree_id)?;

        // Create initial commit on main branch
        let _commit_id = repo.commit(
            Some("refs/heads/main"),
            &signature,
            &signature,
            "Initial commit",
            &tree,
            &[],
        )?;

        // Set HEAD to point to main branch
        repo.set_head("refs/heads/main")?;

        Ok(())
    }

    pub fn commit(&self, path: &Path, message: &str) -> Result<bool, GitServiceError> {
        // Use Git CLI to respect sparse-checkout semantics for staging and commit
        let git = GitCli::new();
        let has_changes = git
            .has_changes(path)
            .map_err(|e| GitServiceError::InvalidRepository(format!("git status failed: {e}")))?;
        if !has_changes {
            tracing::debug!("No changes to commit!");
            return Ok(false);
        }

        git.add_all(path)
            .map_err(|e| GitServiceError::InvalidRepository(format!("git add failed: {e}")))?;
        git.commit(path, message)
            .map_err(|e| GitServiceError::InvalidRepository(format!("git commit failed: {e}")))?;
        Ok(true)
    }

    /// Get diffs between branches or worktree changes
    pub fn get_diffs(
        &self,
        target: DiffTarget,
        path_filter: Option<&[&str]>,
    ) -> Result<Vec<Diff>, GitServiceError> {
        match target {
            DiffTarget::Worktree {
                worktree_path,
                branch_name: _,
                base_branch,
            } => {
                // Use Git CLI to compute diff vs base to avoid sparse false deletions
                let repo = Repository::open(worktree_path)?;
                let base_git_branch = GitService::find_branch(&repo, base_branch)?;
                let base_tree = base_git_branch.get().peel_to_commit()?.tree()?;

                let git = GitCli::new();
                let cli_opts = StatusDiffOptions {
                    path_filter: path_filter.map(|fs| fs.iter().map(|s| s.to_string()).collect()),
                };
                let entries = git
                    .diff_status(worktree_path, base_branch, cli_opts)
                    .map_err(|e| {
                        GitServiceError::InvalidRepository(format!("git diff failed: {e}"))
                    })?;
                Ok(entries
                    .into_iter()
                    .map(|e| Self::status_entry_to_diff(&repo, &base_tree, e))
                    .collect())
            }
            DiffTarget::Branch {
                repo_path,
                branch_name,
                base_branch,
            } => {
                let repo = self.open_repo(repo_path)?;
                let base_tree = Self::find_branch(&repo, base_branch)?
                    .get()
                    .peel_to_commit()?
                    .tree()?;
                let branch_tree = Self::find_branch(&repo, branch_name)?
                    .get()
                    .peel_to_commit()?
                    .tree()?;

                let mut diff_opts = DiffOptions::new();
                diff_opts.include_typechange(true);

                // Add path filtering if specified
                if let Some(paths) = path_filter {
                    for path in paths {
                        diff_opts.pathspec(*path);
                    }
                }

                let mut diff = repo.diff_tree_to_tree(
                    Some(&base_tree),
                    Some(&branch_tree),
                    Some(&mut diff_opts),
                )?;

                // Enable rename detection
                let mut find_opts = DiffFindOptions::new();
                diff.find_similar(Some(&mut find_opts))?;

                self.convert_diff_to_file_diffs(diff, &repo)
            }
            DiffTarget::Commit {
                repo_path,
                commit_sha,
            } => {
                let repo = self.open_repo(repo_path)?;

                // Resolve commit and its baseline (the parent before the squash landed)
                let commit_oid = git2::Oid::from_str(commit_sha).map_err(|_| {
                    GitServiceError::InvalidRepository(format!("Invalid commit SHA: {commit_sha}"))
                })?;
                let commit = repo.find_commit(commit_oid)?;
                let parent = commit.parent(0).map_err(|_| {
                    GitServiceError::InvalidRepository(
                        "Commit has no parent; cannot diff a squash merge without a baseline"
                            .into(),
                    )
                })?;

                let parent_tree = parent.tree()?;
                let commit_tree = commit.tree()?;

                // Diff options
                let mut diff_opts = git2::DiffOptions::new();
                diff_opts.include_typechange(true);

                // Optional path filtering
                if let Some(paths) = path_filter {
                    for path in paths {
                        diff_opts.pathspec(*path);
                    }
                }

                // Compute the diff parent -> commit
                let mut diff = repo.diff_tree_to_tree(
                    Some(&parent_tree),
                    Some(&commit_tree),
                    Some(&mut diff_opts),
                )?;

                // Enable rename detection
                let mut find_opts = git2::DiffFindOptions::new();
                diff.find_similar(Some(&mut find_opts))?;

                self.convert_diff_to_file_diffs(diff, &repo)
            }
        }
    }

    /// Convert git2::Diff to our Diff structs
    fn convert_diff_to_file_diffs(
        &self,
        diff: git2::Diff,
        repo: &Repository,
    ) -> Result<Vec<Diff>, GitServiceError> {
        let mut file_diffs = Vec::new();

        diff.foreach(
            &mut |delta, _| {
                if delta.status() == Delta::Unreadable {
                    return true;
                }

                let status = delta.status();

                // Only build old_file for non-added entries
                let old_file = if matches!(status, Delta::Added) {
                    None
                } else {
                    delta
                        .old_file()
                        .path()
                        .map(|p| self.create_file_details(p, &delta.old_file().id(), repo))
                };

                // Only build new_file for non-deleted entries
                let new_file = if matches!(status, Delta::Deleted) {
                    None
                } else {
                    delta
                        .new_file()
                        .path()
                        .map(|p| self.create_file_details(p, &delta.new_file().id(), repo))
                };

                let mut change = match status {
                    Delta::Added => DiffChangeKind::Added,
                    Delta::Deleted => DiffChangeKind::Deleted,
                    Delta::Modified => DiffChangeKind::Modified,
                    Delta::Renamed => DiffChangeKind::Renamed,
                    Delta::Copied => DiffChangeKind::Copied,
                    Delta::Untracked => DiffChangeKind::Added,
                    _ => DiffChangeKind::Modified,
                };

                let old_path = old_file.as_ref().and_then(|f| f.file_name.clone());
                let new_path = new_file.as_ref().and_then(|f| f.file_name.clone());
                let old_content = old_file.and_then(|f| f.content);
                let new_content = new_file.and_then(|f| f.content);

                // Detect pure mode changes (e.g., chmod +/-x) and classify as PermissionChange
                if matches!(status, Delta::Modified)
                    && delta.old_file().mode() != delta.new_file().mode()
                {
                    // If content unchanged or unavailable, prefer PermissionChange label
                    if old_content
                        .as_ref()
                        .zip(new_content.as_ref())
                        .is_none_or(|(o, n)| o == n)
                    {
                        change = DiffChangeKind::PermissionChange;
                    }
                }

                file_diffs.push(Diff {
                    change,
                    old_path,
                    new_path,
                    old_content,
                    new_content,
                });

                true
            },
            None,
            None,
            None,
        )?;

        Ok(file_diffs)
    }

    /// Extract file path from a Diff (for indexing and ConversationPatch)
    pub fn diff_path(diff: &Diff) -> String {
        diff.new_path
            .clone()
            .or_else(|| diff.old_path.clone())
            .unwrap_or_default()
    }

    /// Helper function to convert blob to string content
    fn blob_to_string(blob: &git2::Blob) -> Option<String> {
        if blob.is_binary() {
            None // Skip binary files
        } else {
            std::str::from_utf8(blob.content())
                .ok()
                .map(|s| s.to_string())
        }
    }

    /// Helper function to read file content from filesystem with safety guards
    fn read_file_to_string(repo: &Repository, rel_path: &Path) -> Option<String> {
        let workdir = repo.workdir()?;
        let abs_path = workdir.join(rel_path);

        // Read file from filesystem
        let bytes = match std::fs::read(&abs_path) {
            Ok(bytes) => bytes,
            Err(e) => {
                tracing::debug!("Failed to read file from filesystem: {:?}: {}", abs_path, e);
                return None;
            }
        };

        // Size guard - skip files larger than 1MB
        if bytes.len() > 1_048_576 {
            tracing::debug!(
                "Skipping large file ({}MB): {:?}",
                bytes.len() / 1_048_576,
                abs_path
            );
            return None;
        }

        // Binary guard - skip files containing null bytes
        if bytes.contains(&0) {
            tracing::debug!("Skipping binary file: {:?}", abs_path);
            return None;
        }

        // UTF-8 validation
        match String::from_utf8(bytes) {
            Ok(content) => Some(content),
            Err(e) => {
                tracing::debug!("File is not valid UTF-8: {:?}: {}", abs_path, e);
                None
            }
        }
    }

    /// Create FileDiffDetails from path and blob with filesystem fallback
    fn create_file_details(
        &self,
        path: &Path,
        blob_id: &git2::Oid,
        repo: &Repository,
    ) -> FileDiffDetails {
        let file_name = path.to_string_lossy().to_string();

        // Try to get content from blob first (for non-zero OIDs)
        let content = if !blob_id.is_zero() {
            repo.find_blob(*blob_id)
                .ok()
                .and_then(|blob| Self::blob_to_string(&blob))
                .or_else(|| {
                    // Fallback to filesystem for unstaged changes
                    tracing::debug!(
                        "Blob not found for non-zero OID, reading from filesystem: {}",
                        file_name
                    );
                    Self::read_file_to_string(repo, path)
                })
        } else {
            // For zero OIDs, check filesystem directly (covers new/untracked files)
            Self::read_file_to_string(repo, path)
        };

        FileDiffDetails {
            file_name: Some(file_name),
            content,
        }
    }

    /// Create Diff entries from git_cli::StatusDiffEntry
    /// New Diff format is flattened with change kind, paths, and optional contents.
    fn status_entry_to_diff(repo: &Repository, base_tree: &git2::Tree, e: StatusDiffEntry) -> Diff {
        // Map ChangeType to DiffChangeKind
        let mut change = match e.change {
            ChangeType::Added => DiffChangeKind::Added,
            ChangeType::Deleted => DiffChangeKind::Deleted,
            ChangeType::Modified => DiffChangeKind::Modified,
            ChangeType::Renamed => DiffChangeKind::Renamed,
            ChangeType::Copied => DiffChangeKind::Copied,
            // Treat type changes and unmerged as modified for now
            ChangeType::TypeChanged | ChangeType::Unmerged => DiffChangeKind::Modified,
            ChangeType::Unknown(_) => DiffChangeKind::Modified,
        };

        // Determine old/new paths based on change
        let (old_path_opt, new_path_opt): (Option<String>, Option<String>) = match e.change {
            ChangeType::Added => (None, Some(e.path.clone())),
            ChangeType::Deleted => (Some(e.old_path.unwrap_or(e.path.clone())), None),
            ChangeType::Modified | ChangeType::TypeChanged | ChangeType::Unmerged => (
                Some(e.old_path.unwrap_or(e.path.clone())),
                Some(e.path.clone()),
            ),
            ChangeType::Renamed | ChangeType::Copied => (e.old_path.clone(), Some(e.path.clone())),
            ChangeType::Unknown(_) => (e.old_path.clone(), Some(e.path.clone())),
        };

        // Load old content from base tree if possible
        let old_content = if let Some(ref oldp) = old_path_opt {
            let rel = std::path::Path::new(oldp);
            match base_tree.get_path(rel) {
                Ok(entry) if entry.kind() == Some(git2::ObjectType::Blob) => repo
                    .find_blob(entry.id())
                    .ok()
                    .and_then(|b| Self::blob_to_string(&b)),
                _ => None,
            }
        } else {
            None
        };

        // Load new content from filesystem (worktree) when available
        let new_content = if let Some(ref newp) = new_path_opt {
            let rel = std::path::Path::new(newp);
            Self::read_file_to_string(repo, rel)
        } else {
            None
        };

        // If reported as Modified but content is identical, treat as a permission-only change
        if matches!(change, DiffChangeKind::Modified)
            && old_content
                .as_ref()
                .zip(new_content.as_ref())
                .is_none_or(|(o, n)| o == n)
        {
            change = DiffChangeKind::PermissionChange;
        }

        Diff {
            change,
            old_path: old_path_opt,
            new_path: new_path_opt,
            old_content,
            new_content,
        }
    }

    /// Merge changes from a worktree branch back to the main repository
    pub fn merge_changes(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        branch_name: &str,
        base_branch_name: &str,
        commit_message: &str,
    ) -> Result<String, GitServiceError> {
        // Open the worktree repository
        let worktree_repo = self.open_repo(worktree_path)?;
        let main_repo = self.open_repo(repo_path)?;

        // Check if worktree is dirty before proceeding
        self.check_worktree_clean(&worktree_repo)?;
        self.check_worktree_clean(&main_repo)?;

        // Verify the task branch exists in the worktree
        let task_branch = Self::find_branch(&worktree_repo, branch_name)?;

        // Get the base branch from the worktree
        let base_branch = Self::find_branch(&worktree_repo, base_branch_name)?;

        // Get commits
        let base_commit = base_branch.get().peel_to_commit()?;
        let task_commit = task_branch.get().peel_to_commit()?;

        // Get the signature for the merge commit
        let signature = worktree_repo.signature()?;

        // Perform a squash merge - create a single commit with all changes
        let squash_commit_id = self.perform_squash_merge(
            &worktree_repo,
            &base_commit,
            &task_commit,
            &signature,
            commit_message,
            base_branch_name,
        )?;

        // Reset the task branch to point to the squash commit
        // This allows follow-up work to continue from the merged state without conflicts
        let task_refname = format!("refs/heads/{branch_name}");
        main_repo.reference(
            &task_refname,
            squash_commit_id,
            true,
            "Reset task branch after merge in main repo",
        )?;

        // Fix: Update main repo's HEAD if it's pointing to the base branch
        let refname = format!("refs/heads/{base_branch_name}");

        if let Ok(main_head) = main_repo.head()
            && let Some(branch_name) = main_head.shorthand()
            && branch_name == base_branch_name
        {
            // Only update main repo's HEAD if it's currently on the base branch
            main_repo.set_head(&refname)?;
            let mut co = CheckoutBuilder::new();
            co.force();
            main_repo.checkout_head(Some(&mut co))?;
        }

        Ok(squash_commit_id.to_string())
    }
    fn get_branch_status_inner(
        &self,
        repo: &Repository,
        branch_ref: &Reference,
        base_branch_ref: &Reference,
    ) -> Result<(usize, usize), GitServiceError> {
        let (a, b) = repo.graph_ahead_behind(
            branch_ref.target().ok_or(GitServiceError::BranchNotFound(
                "Branch not found".to_string(),
            ))?,
            base_branch_ref
                .target()
                .ok_or(GitServiceError::BranchNotFound(
                    "Branch not found".to_string(),
                ))?,
        )?;
        Ok((a, b))
    }

    pub fn get_branch_status(
        &self,
        repo_path: &Path,
        branch_name: &str,
        base_branch_name: &str,
    ) -> Result<(usize, usize), GitServiceError> {
        let repo = Repository::open(repo_path)?;
        let branch = Self::find_branch(&repo, branch_name)?;
        let base_branch = Self::find_branch(&repo, base_branch_name)?;
        self.get_branch_status_inner(
            &repo,
            &branch.into_reference(),
            &base_branch.into_reference(),
        )
    }

    pub fn get_remote_branch_status(
        &self,
        repo_path: &Path,
        branch_name: &str,
        base_branch_name: Option<&str>,
        github_token: String,
    ) -> Result<(usize, usize), GitServiceError> {
        let repo = Repository::open(repo_path)?;
        let branch_ref = Self::find_branch(&repo, branch_name)?.into_reference();
        // base branch is either given or upstream of branch_name
        let base_branch_ref = if let Some(bn) = base_branch_name {
            Self::find_branch(&repo, bn)?
        } else {
            repo.find_branch(branch_name, BranchType::Local)?
                .upstream()?
        }
        .into_reference();
        let remote = self.get_remote_from_branch_ref(&repo, &base_branch_ref)?;
        self.fetch_from_remote(&repo, &github_token, &remote)?;
        self.get_branch_status_inner(&repo, &branch_ref, &base_branch_ref)
    }

    pub fn is_worktree_clean(&self, worktree_path: &Path) -> Result<bool, GitServiceError> {
        let repo = self.open_repo(worktree_path)?;
        match self.check_worktree_clean(&repo) {
            Ok(()) => Ok(true),
            Err(GitServiceError::WorktreeDirty(_, _)) => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// Check if the worktree is clean (no uncommitted changes to tracked files)
    fn check_worktree_clean(&self, repo: &Repository) -> Result<(), GitServiceError> {
        let mut status_options = git2::StatusOptions::new();
        status_options
            .include_untracked(false) // Don't include untracked files
            .include_ignored(false); // Don't include ignored files

        let statuses = repo.statuses(Some(&mut status_options))?;

        if !statuses.is_empty() {
            let mut dirty_files = Vec::new();
            for entry in statuses.iter() {
                let status = entry.status();
                // Only consider files that are actually tracked and modified
                if status.intersects(
                    git2::Status::INDEX_MODIFIED
                        | git2::Status::INDEX_NEW
                        | git2::Status::INDEX_DELETED
                        | git2::Status::INDEX_RENAMED
                        | git2::Status::INDEX_TYPECHANGE
                        | git2::Status::WT_MODIFIED
                        | git2::Status::WT_DELETED
                        | git2::Status::WT_RENAMED
                        | git2::Status::WT_TYPECHANGE,
                ) && let Some(path) = entry.path()
                {
                    dirty_files.push(path.to_string());
                }
            }

            if !dirty_files.is_empty() {
                let branch_name = repo
                    .head()
                    .ok()
                    .and_then(|h| h.shorthand().map(|s| s.to_string()))
                    .unwrap_or_else(|| "unknown branch".to_string());
                return Err(GitServiceError::WorktreeDirty(
                    branch_name,
                    dirty_files.join(", "),
                ));
            }
        }

        Ok(())
    }

    /// Get current HEAD information including branch name and commit OID
    pub fn get_head_info(&self, repo_path: &Path) -> Result<HeadInfo, GitServiceError> {
        let repo = self.open_repo(repo_path)?;
        let head = repo.head()?;

        let branch = if let Some(branch_name) = head.shorthand() {
            branch_name.to_string()
        } else {
            "HEAD".to_string()
        };

        let oid = if let Some(target_oid) = head.target() {
            target_oid.to_string()
        } else {
            // Handle case where HEAD exists but has no target (empty repo)
            return Err(GitServiceError::InvalidRepository(
                "Repository HEAD has no target commit".to_string(),
            ));
        };

        Ok(HeadInfo { branch, oid })
    }

    pub fn get_current_branch(&self, repo_path: &Path) -> Result<String, git2::Error> {
        // Thin wrapper for backward compatibility
        match self.get_head_info(repo_path) {
            Ok(head_info) => Ok(head_info.branch),
            Err(GitServiceError::Git(git_err)) => Err(git_err),
            Err(_) => Err(git2::Error::from_str("Failed to get head info")),
        }
    }

    pub fn get_all_branches(&self, repo_path: &Path) -> Result<Vec<GitBranch>, git2::Error> {
        let repo = Repository::open(repo_path)?;
        let current_branch = self.get_current_branch(repo_path).unwrap_or_default();
        let mut branches = Vec::new();

        // Helper function to get last commit date for a branch
        let get_last_commit_date = |branch: &git2::Branch| -> Result<DateTime<Utc>, git2::Error> {
            if let Some(target) = branch.get().target()
                && let Ok(commit) = repo.find_commit(target)
            {
                let timestamp = commit.time().seconds();
                return Ok(DateTime::from_timestamp(timestamp, 0).unwrap_or_else(Utc::now));
            }
            Ok(Utc::now()) // Default to now if we can't get the commit date
        };

        // Get local branches
        let local_branches = repo.branches(Some(BranchType::Local))?;
        for branch_result in local_branches {
            let (branch, _) = branch_result?;
            if let Some(name) = branch.name()? {
                let last_commit_date = get_last_commit_date(&branch)?;
                branches.push(GitBranch {
                    name: name.to_string(),
                    is_current: name == current_branch,
                    is_remote: false,
                    last_commit_date,
                });
            }
        }

        // Get remote branches
        let remote_branches = repo.branches(Some(BranchType::Remote))?;
        for branch_result in remote_branches {
            let (branch, _) = branch_result?;
            if let Some(name) = branch.name()? {
                // Skip remote HEAD references
                if !name.ends_with("/HEAD") {
                    let last_commit_date = get_last_commit_date(&branch)?;
                    branches.push(GitBranch {
                        name: name.to_string(),
                        is_current: false,
                        is_remote: true,
                        last_commit_date,
                    });
                }
            }
        }

        // Sort branches: current first, then by most recent commit date
        branches.sort_by(|a, b| {
            if a.is_current && !b.is_current {
                std::cmp::Ordering::Less
            } else if !a.is_current && b.is_current {
                std::cmp::Ordering::Greater
            } else {
                // Sort by most recent commit date (newest first)
                b.last_commit_date.cmp(&a.last_commit_date)
            }
        });

        Ok(branches)
    }

    /// Perform a squash merge of task branch into base branch, but fail on conflicts
    fn perform_squash_merge(
        &self,
        repo: &Repository,
        base_commit: &git2::Commit,
        task_commit: &git2::Commit,
        signature: &git2::Signature,
        commit_message: &str,
        base_branch_name: &str,
    ) -> Result<git2::Oid, GitServiceError> {
        // Attempt an in-memory merge to detect conflicts
        let merge_opts = git2::MergeOptions::new();
        let mut index = repo.merge_commits(base_commit, task_commit, Some(&merge_opts))?;

        // If there are conflicts, return an error
        if index.has_conflicts() {
            return Err(GitServiceError::MergeConflicts(
                "Merge failed due to conflicts. Please resolve conflicts manually.".to_string(),
            ));
        }

        // Write the merged tree back to the repository
        let tree_id = index.write_tree_to(repo)?;
        let tree = repo.find_tree(tree_id)?;

        // Create a squash commit: use merged tree with base_commit as sole parent
        let squash_commit_id = repo.commit(
            None,           // Don't update any reference yet
            signature,      // Author
            signature,      // Committer
            commit_message, // Custom message
            &tree,          // Merged tree content
            &[base_commit], // Single parent: base branch commit
        )?;

        // Update the base branch reference to point to the new commit
        let refname = format!("refs/heads/{base_branch_name}");
        repo.reference(&refname, squash_commit_id, true, "Squash merge")?;

        Ok(squash_commit_id)
    }

    /// Rebase a worktree branch onto a new base
    pub fn rebase_branch(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        new_base_branch: Option<&str>,
        old_base_branch: &str,
        github_token: Option<String>,
    ) -> Result<String, GitServiceError> {
        let worktree_repo = Repository::open(worktree_path)?;
        let main_repo = self.open_repo(repo_path)?;

        // Safety guard: never operate on a dirty worktree. This preserves any
        // uncommitted changes to tracked files by failing fast instead of
        // resetting or cherry-picking over them. Untracked files are allowed.
        self.check_worktree_clean(&worktree_repo)?;

        // Check if there's an existing rebase in progress and abort it
        let state = worktree_repo.state();
        if state == git2::RepositoryState::Rebase
            || state == git2::RepositoryState::RebaseInteractive
            || state == git2::RepositoryState::RebaseMerge
        {
            tracing::warn!("Existing rebase in progress, aborting it first");
            // Try to abort the existing rebase
            if let Ok(mut existing_rebase) = worktree_repo.open_rebase(None) {
                let _ = existing_rebase.abort();
            }
        }

        // Get the target base branch reference
        let new_base_branch_name = match new_base_branch {
            Some(branch) => branch.to_string(),
            None => main_repo
                .head()
                .ok()
                .and_then(|head| head.shorthand().map(|s| s.to_string()))
                .unwrap_or_else(|| "main".to_string()),
        };
        let nbr = Self::find_branch(&main_repo, &new_base_branch_name)?.into_reference();
        let new_base_commit_id = if nbr.is_remote() {
            let github_token = github_token.ok_or(GitServiceError::TokenUnavailable)?;
            let remote = self.get_remote_from_branch_ref(&main_repo, &nbr)?;
            // First, fetch the latest changes from remote
            self.fetch_from_remote(&main_repo, &github_token, &remote)?;
            // Try to find the remote branch after fetch
            let remote_branch = Self::find_branch(&main_repo, &new_base_branch_name)?;
            remote_branch.into_reference().peel_to_commit()?.id()
            // Use the local branch name for rebase
        } else {
            nbr.peel_to_commit()?.id()
        };

        // Remember the original task-branch commit before we touch anything
        let original_head_oid = worktree_repo.head()?.peel_to_commit()?.id();
        // Get the HEAD commit of the worktree (the changes to rebase)
        let task_branch_commit_id = worktree_repo.head()?.peel_to_commit()?.id();

        let signature = worktree_repo.signature()?;
        let old_base_commit_id = Self::find_branch(&main_repo, old_base_branch)?
            .into_reference()
            .peel_to_commit()?
            .id();

        // Find commits unique to the task branch
        let unique_commits = Self::find_unique_commits(
            &worktree_repo,
            task_branch_commit_id,
            old_base_commit_id,
            new_base_commit_id,
        )?;

        // Attempt the rebase operation
        let rebase_result = if !unique_commits.is_empty() {
            // Reset HEAD to the new base branch
            let new_base_commit = worktree_repo.find_commit(new_base_commit_id)?;
            worktree_repo.reset(new_base_commit.as_object(), git2::ResetType::Hard, None)?;

            // Cherry-pick the unique commits
            Self::cherry_pick_commits(&worktree_repo, &unique_commits, &signature)
        } else {
            // No unique commits to rebase, just reset to new base
            let new_base_commit = worktree_repo.find_commit(new_base_commit_id)?;
            worktree_repo.reset(new_base_commit.as_object(), git2::ResetType::Hard, None)?;
            Ok(())
        };

        // Handle rebase failure by restoring original state
        if let Err(e) = rebase_result {
            // Clean up any cherry-pick state
            let _ = worktree_repo.cleanup_state();

            // Restore original task branch state
            if let Ok(orig_commit) = worktree_repo.find_commit(original_head_oid) {
                let _ = worktree_repo.reset(orig_commit.as_object(), git2::ResetType::Hard, None);
            }

            return Err(e);
        }

        // Get the final commit ID after rebase
        let final_commit = worktree_repo.head()?.peel_to_commit()?;

        Ok(final_commit.id().to_string())
    }

    pub fn find_branch_type(
        &self,
        repo_path: &Path,
        branch_name: &str,
    ) -> Result<BranchType, GitServiceError> {
        let repo = self.open_repo(repo_path)?;
        // Try to find the branch as a local branch first
        match repo.find_branch(branch_name, BranchType::Local) {
            Ok(_) => Ok(BranchType::Local),
            Err(_) => {
                // If not found, try to find it as a remote branch
                match repo.find_branch(branch_name, BranchType::Remote) {
                    Ok(_) => Ok(BranchType::Remote),
                    Err(_) => Err(GitServiceError::BranchNotFound(branch_name.to_string())),
                }
            }
        }
    }

    pub fn find_branch<'a>(
        repo: &'a Repository,
        branch_name: &str,
    ) -> Result<git2::Branch<'a>, GitServiceError> {
        // Try to find the branch as a local branch first
        match repo.find_branch(branch_name, BranchType::Local) {
            Ok(branch) => Ok(branch),
            Err(_) => {
                // If not found, try to find it as a remote branch
                match repo.find_branch(branch_name, BranchType::Remote) {
                    Ok(branch) => Ok(branch),
                    Err(_) => Err(GitServiceError::BranchNotFound(branch_name.to_string())),
                }
            }
        }
    }

    /// Delete a file from the repository and commit the change
    pub fn delete_file_and_commit(
        &self,
        worktree_path: &Path,
        file_path: &str,
    ) -> Result<String, GitServiceError> {
        let repo = Repository::open(worktree_path)?;

        // Get the absolute path to the file within the worktree
        let file_full_path = worktree_path.join(file_path);

        // Check if file exists and delete it
        if file_full_path.exists() {
            std::fs::remove_file(&file_full_path).map_err(|e| {
                GitServiceError::IoError(std::io::Error::other(format!(
                    "Failed to delete file {file_path}: {e}"
                )))
            })?;
        }

        // Stage the deletion
        let mut index = repo.index()?;
        index.remove_path(Path::new(file_path))?;
        index.write()?;

        // Create a commit for the file deletion
        let signature = repo.signature()?;
        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;

        // Get the current HEAD commit
        let head = repo.head()?;
        let parent_commit = head.peel_to_commit()?;

        let commit_message = format!("Delete file: {file_path}");
        let commit_id = repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &commit_message,
            &tree,
            &[&parent_commit],
        )?;

        Ok(commit_id.to_string())
    }

    /// Get the default branch name for the repository
    pub fn get_default_branch_name(&self, repo_path: &Path) -> Result<String, GitServiceError> {
        let repo = self.open_repo(repo_path)?;

        match repo.head() {
            Ok(head_ref) => Ok(head_ref.shorthand().unwrap_or("main").to_string()),
            Err(e)
                if e.class() == git2::ErrorClass::Reference
                    && e.code() == git2::ErrorCode::UnbornBranch =>
            {
                Ok("main".to_string()) // Repository has no commits yet
            }
            Err(_) => Ok("main".to_string()), // Fallback
        }
    }

    /// Extract GitHub owner and repo name from git repo path
    pub fn get_github_repo_info(
        &self,
        repo_path: &Path,
    ) -> Result<GitHubRepoInfo, GitServiceError> {
        let repo = self.open_repo(repo_path)?;
        let remote_name = self.default_remote_name(&repo);
        let remote = repo.find_remote(&remote_name).map_err(|_| {
            GitServiceError::InvalidRepository(format!("No '{remote_name}' remote found"))
        })?;

        let url = remote
            .url()
            .ok_or_else(|| GitServiceError::InvalidRepository("Remote has no URL".to_string()))?;

        // Parse GitHub URL (supports both HTTPS and SSH formats)
        let github_regex = regex::Regex::new(r"github\.com[:/]([^/]+)/(.+?)(?:\.git)?/?$")
            .map_err(|e| GitServiceError::InvalidRepository(format!("Regex error: {e}")))?;

        if let Some(captures) = github_regex.captures(url) {
            let owner = captures.get(1).unwrap().as_str().to_string();
            let repo_name = captures.get(2).unwrap().as_str().to_string();
            Ok(GitHubRepoInfo { owner, repo_name })
        } else {
            Err(GitServiceError::InvalidRepository(format!(
                "Not a GitHub repository: {url}"
            )))
        }
    }

    pub fn get_remote_name_from_branch_name(
        &self,
        repo_path: &Path,
        branch_name: &str,
    ) -> Result<String, GitServiceError> {
        let repo = Repository::open(repo_path)?;
        let branch_ref = Self::find_branch(&repo, branch_name)?.into_reference();
        let default_remote = self.default_remote_name(&repo);
        self.get_remote_from_branch_ref(&repo, &branch_ref)
            .map(|r| r.name().unwrap_or(&default_remote).to_string())
    }

    fn get_remote_from_branch_ref<'a>(
        &self,
        repo: &'a Repository,
        branch_ref: &Reference,
    ) -> Result<Remote<'a>, GitServiceError> {
        let branch_name = branch_ref
            .name()
            .map(|name| name.to_string())
            .ok_or_else(|| GitServiceError::InvalidRepository("Invalid branch ref".into()))?;
        let remote_name_buf = repo.branch_remote_name(&branch_name)?;

        let remote_name = str::from_utf8(&remote_name_buf)
            .map_err(|e| {
                GitServiceError::InvalidRepository(format!(
                    "Invalid remote name for branch {branch_name}: {e}"
                ))
            })?
            .to_string();
        repo.find_remote(&remote_name).map_err(|_| {
            GitServiceError::InvalidRepository(format!(
                "Remote '{remote_name}' for branch '{branch_name}' not found"
            ))
        })
    }

    pub fn push_to_github(
        &self,
        worktree_path: &Path,
        branch_name: &str,
        github_token: &str,
    ) -> Result<(), GitServiceError> {
        let repo = Repository::open(worktree_path)?;
        self.check_worktree_clean(&repo)?;

        // Get the remote
        let remote_name = self.default_remote_name(&repo);
        let remote = repo.find_remote(&remote_name)?;

        let remote_url = remote
            .url()
            .ok_or_else(|| GitServiceError::InvalidRepository("Remote has no URL".to_string()))?;
        let https_url = self.convert_to_https_url(remote_url);

        // Create a temporary remote with HTTPS URL for pushing
        let temp_remote_name = "temp_https_origin";

        // Remove any existing temp remote
        let _ = repo.remote_delete(temp_remote_name);

        // Create temporary HTTPS remote
        let mut temp_remote = repo.remote(temp_remote_name, &https_url)?;

        // Create refspec for pushing the branch
        let refspec = format!("refs/heads/{branch_name}:refs/heads/{branch_name}");

        // Set up authentication callback using the GitHub token
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|_url, username_from_url, _allowed_types| {
            git2::Cred::userpass_plaintext(username_from_url.unwrap_or("git"), github_token)
        });

        // Configure push options
        let mut push_options = git2::PushOptions::new();
        push_options.remote_callbacks(callbacks);

        // Push the branch
        let push_result = temp_remote.push(&[&refspec], Some(&mut push_options));

        // Clean up the temporary remote
        let _ = repo.remote_delete(temp_remote_name);

        // Check push result
        push_result.map_err(|e| match e.code() {
            git2::ErrorCode::NotFastForward => {
                GitServiceError::BranchesDiverged(format!(
                    "Push failed: branch '{branch_name}' has diverged and cannot be fast-forwarded. Either merge the changes or force push."
                ))
            }
            _ => e.into(),
        })?;
        self.fetch_from_remote(&repo, github_token, &remote)?;
        let mut branch = Self::find_branch(&repo, branch_name)?;
        if !branch.get().is_remote() {
            branch.set_upstream(Some(&format!("{remote_name}/{branch_name}")))?;
        }

        Ok(())
    }

    fn convert_to_https_url(&self, url: &str) -> String {
        // Convert SSH URL to HTTPS URL if necessary
        if url.starts_with("git@github.com:") {
            // Convert git@github.com:owner/repo.git to https://github.com/owner/repo.git
            url.replace("git@github.com:", "https://github.com/")
        } else if url.starts_with("ssh://git@github.com/") {
            // Convert ssh://git@github.com/owner/repo.git to https://github.com/owner/repo.git
            url.replace("ssh://git@github.com/", "https://github.com/")
        } else {
            url.to_string()
        }
    }

    /// Fetch from remote repository using GitHub token authentication
    fn fetch_from_remote(
        &self,
        repo: &Repository,
        github_token: &str,
        remote: &Remote,
    ) -> Result<(), GitServiceError> {
        // Get the remote
        let remote_url = remote
            .url()
            .ok_or_else(|| GitServiceError::InvalidRepository("Remote has no URL".to_string()))?;

        // Create a temporary remote with HTTPS URL for fetching
        let temp_remote_name = "temp_https_origin";

        // Remove any existing temp remote
        let _ = repo.remote_delete(temp_remote_name);

        let https_url = self.convert_to_https_url(remote_url);
        // Create temporary HTTPS remote
        let mut temp_remote = repo.remote(temp_remote_name, &https_url)?;

        // Set up authentication callback using the GitHub token
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|_url, username_from_url, _allowed_types| {
            git2::Cred::userpass_plaintext(username_from_url.unwrap_or("git"), github_token)
        });

        // Configure fetch options
        let mut fetch_opts = FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        let default_remote_name = self.default_remote_name(repo);
        let remote_name = remote.name().unwrap_or(&default_remote_name);

        let refspec = format!("+refs/heads/*:refs/remotes/{remote_name}/*");

        let fetch_result = temp_remote.fetch(&[&refspec], Some(&mut fetch_opts), None);
        // Clean up the temporary remote
        let _ = repo.remote_delete(temp_remote_name);

        // Check fetch result
        fetch_result.map_err(GitServiceError::Git)?;

        Ok(())
    }

    /// Find the merge-base between two commits
    fn get_merge_base(
        repo: &Repository,
        commit1: git2::Oid,
        commit2: git2::Oid,
    ) -> Result<git2::Oid, GitServiceError> {
        repo.merge_base(commit1, commit2)
            .map_err(GitServiceError::Git)
    }

    /// Find commits that are unique to the task branch (not in either base branch)
    fn find_unique_commits(
        repo: &Repository,
        task_branch_commit: git2::Oid,
        old_base_commit: git2::Oid,
        new_base_commit: git2::Oid,
    ) -> Result<Vec<git2::Oid>, GitServiceError> {
        // Find merge-base between task branch and old base branch
        let task_old_base_merge_base =
            Self::get_merge_base(repo, task_branch_commit, old_base_commit)?;

        // Find merge-base between old base and new base
        let old_new_base_merge_base = Self::get_merge_base(repo, old_base_commit, new_base_commit)?;

        // Get all commits from task branch back to the merge-base with old base
        let mut walker = repo.revwalk()?;
        walker.push(task_branch_commit)?;
        walker.hide(task_old_base_merge_base)?;

        let mut task_commits = Vec::new();
        for commit_id in walker {
            let commit_id = commit_id?;

            // Check if this commit is not in the old base branch lineage
            // (i.e., it's not between old_new_base_merge_base and old_base_commit)
            let is_in_old_base = repo
                .graph_descendant_of(commit_id, old_new_base_merge_base)
                .unwrap_or(false)
                && repo
                    .graph_descendant_of(old_base_commit, commit_id)
                    .unwrap_or(false);

            if !is_in_old_base {
                task_commits.push(commit_id);
            }
        }

        // Reverse to get chronological order for cherry-picking
        task_commits.reverse();
        Ok(task_commits)
    }

    /// Cherry-pick specific commits onto a new base
    fn cherry_pick_commits(
        repo: &Repository,
        commits: &[git2::Oid],
        signature: &git2::Signature,
    ) -> Result<(), GitServiceError> {
        for &commit_id in commits {
            let commit = repo.find_commit(commit_id)?;

            // Cherry-pick the commit
            let mut cherrypick_opts = CherrypickOptions::new();
            repo.cherrypick(&commit, Some(&mut cherrypick_opts))?;

            // Check for conflicts
            let mut index = repo.index()?;
            if index.has_conflicts() {
                return Err(GitServiceError::MergeConflicts(format!(
                    "Cherry-pick failed due to conflicts on commit {commit_id}, please resolve conflicts manually"
                )));
            }

            // Commit the cherry-pick
            let tree_id = index.write_tree()?;
            let tree = repo.find_tree(tree_id)?;
            let head_commit = repo.head()?.peel_to_commit()?;

            repo.commit(
                Some("HEAD"),
                signature,
                signature,
                commit.message().unwrap_or("Cherry-picked commit"),
                &tree,
                &[&head_commit],
            )?;
        }

        Ok(())
    }

    /// Clone a repository to the specified directory
    #[cfg(feature = "cloud")]
    pub fn clone_repository(
        clone_url: &str,
        target_path: &Path,
        token: Option<&str>,
    ) -> Result<Repository, GitServiceError> {
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Set up callbacks for authentication if token is provided
        let mut callbacks = RemoteCallbacks::new();
        if let Some(token) = token {
            callbacks.credentials(|_url, username_from_url, _allowed_types| {
                Cred::userpass_plaintext(username_from_url.unwrap_or("git"), token)
            });
        } else {
            // Fallback to SSH agent and key file authentication
            callbacks.credentials(|_url, username_from_url, _| {
                // Try SSH agent first
                if let Some(username) = username_from_url {
                    if let Ok(cred) = Cred::ssh_key_from_agent(username) {
                        return Ok(cred);
                    }
                }
                // Fallback to key file (~/.ssh/id_rsa)
                let home = dirs::home_dir()
                    .ok_or_else(|| git2::Error::from_str("Could not find home directory"))?;
                let key_path = home.join(".ssh").join("id_rsa");
                Cred::ssh_key(username_from_url.unwrap_or("git"), None, &key_path, None)
            });
        }

        // Set up fetch options with our callbacks
        let mut fetch_opts = FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);

        // Create a repository builder with fetch options
        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fetch_opts);

        let repo = builder.clone(clone_url, target_path)?;

        tracing::info!(
            "Successfully cloned repository from {} to {}",
            clone_url,
            target_path.display()
        );

        Ok(repo)
    }

    /// Collect file statistics from recent commits for ranking purposes
    pub fn collect_recent_file_stats(
        &self,
        repo_path: &Path,
        commit_limit: usize,
    ) -> Result<HashMap<String, FileStat>, GitServiceError> {
        let repo = self.open_repo(repo_path)?;
        let mut stats: HashMap<String, FileStat> = HashMap::new();

        // Set up revision walk from HEAD
        let mut revwalk = repo.revwalk()?;
        revwalk.push_head()?;
        revwalk.set_sorting(Sort::TIME)?;

        // Iterate through recent commits
        for (commit_index, oid_result) in revwalk.take(commit_limit).enumerate() {
            let oid = oid_result?;
            let commit = repo.find_commit(oid)?;

            // Get commit timestamp
            let commit_time = {
                let time = commit.time();
                DateTime::from_timestamp(time.seconds(), 0).unwrap_or_else(Utc::now)
            };

            // Get the commit tree
            let commit_tree = commit.tree()?;

            // For the first commit (no parent), diff against empty tree
            let parent_tree = if commit.parent_count() == 0 {
                None
            } else {
                Some(commit.parent(0)?.tree()?)
            };

            // Create diff between parent and current commit
            let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), None)?;

            // Process each changed file in this commit
            diff.foreach(
                &mut |delta, _progress| {
                    // Get the file path - prefer new file path, fall back to old
                    if let Some(path) = delta.new_file().path().or_else(|| delta.old_file().path())
                    {
                        let path_str = path.to_string_lossy().to_string();

                        // Update or insert file stats
                        let stat = stats.entry(path_str).or_insert(FileStat {
                            last_index: commit_index,
                            commit_count: 0,
                            last_time: commit_time,
                        });

                        // Increment commit count
                        stat.commit_count += 1;

                        // Keep the most recent change (smallest index)
                        if commit_index < stat.last_index {
                            stat.last_index = commit_index;
                            stat.last_time = commit_time;
                        }
                    }

                    true // Continue iteration
                },
                None, // No binary callback
                None, // No hunk callback
                None, // No line callback
            )?;
        }

        Ok(stats)
    }
}

// #[cfg(test)]
// mod tests {
//     use tempfile::TempDir;

//     use super::*;

//     fn create_test_repo() -> (TempDir, Repository) {
//         let temp_dir = TempDir::new().unwrap();
//         let repo = Repository::init(temp_dir.path()).unwrap();

//         // Configure the repository
//         let mut config = repo.config().unwrap();
//         config.set_str("user.name", "Test User").unwrap();
//         config.set_str("user.email", "test@example.com").unwrap();

//         (temp_dir, repo)
//     }

//     #[test]
//     fn test_git_service_creation() {
//         let (temp_dir, _repo) = create_test_repo();
//         let _git_service = GitService::new(temp_dir.path()).unwrap();
//     }

//     #[test]
//     fn test_invalid_repository_path() {
//         let result = GitService::new("/nonexistent/path");
//         assert!(result.is_err());
//     }

//     #[test]
//     fn test_default_branch_name() {
//         let (temp_dir, _repo) = create_test_repo();
//         let git_service = GitService::new(temp_dir.path()).unwrap();
//         let branch_name = git_service.get_default_branch_name().unwrap();
//         assert_eq!(branch_name, "main");
//     }
// }
