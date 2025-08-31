use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use futures::{
    SinkExt, StreamExt,
    channel::mpsc::{Receiver, channel},
};
use ignore::{
    WalkBuilder,
    gitignore::{Gitignore, GitignoreBuilder},
};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{
    DebounceEventResult, DebouncedEvent, Debouncer, RecommendedCache, new_debouncer,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum FilesystemWatcherError {
    #[error(transparent)]
    Notify(#[from] notify::Error),
    #[error(transparent)]
    Ignore(#[from] ignore::Error),
    #[error(transparent)]
    IoError(#[from] std::io::Error),
    #[error("Failed to build gitignore: {0}")]
    GitignoreBuilder(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
}

fn canonicalize_lossy(path: &Path) -> PathBuf {
    dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn build_gitignore_set(root: &Path) -> Result<Gitignore, FilesystemWatcherError> {
    let mut builder = GitignoreBuilder::new(root);

    // Walk once to collect all .gitignore files under root
    for result in WalkBuilder::new(root)
        .follow_links(false)
        .hidden(false) // we *want* to see .gitignore
        .standard_filters(false) // do not apply default ignores while walking
        .git_ignore(false) // we'll add them manually
        .git_exclude(false)
        .build()
    {
        let dir_entry = result?;
        if dir_entry
            .file_type()
            .map(|ft| ft.is_file())
            .unwrap_or(false)
            && dir_entry
                .path()
                .file_name()
                .is_some_and(|name| name == ".gitignore")
        {
            builder.add(dir_entry.path());
        }
    }

    // Optionally include repo-local excludes
    let info_exclude = root.join(".git/info/exclude");
    if info_exclude.exists() {
        builder.add(info_exclude);
    }

    Ok(builder.build()?)
}

fn path_allowed(path: &Path, gi: &Gitignore, canonical_root: &Path) -> bool {
    let canonical_path = canonicalize_lossy(path);

    // Convert absolute path to relative path from the gitignore root
    let relative_path = match canonical_path.strip_prefix(canonical_root) {
        Ok(rel_path) => rel_path,
        Err(_) => {
            // Path is outside the watched root, don't ignore it
            return true;
        }
    };

    // Heuristic: assume paths without extensions are directories
    // This works for most cases and avoids filesystem syscalls
    let is_dir = relative_path.extension().is_none();
    let matched = gi.matched_path_or_any_parents(relative_path, is_dir);

    !matched.is_ignore()
}

fn debounced_should_forward(event: &DebouncedEvent, gi: &Gitignore, canonical_root: &Path) -> bool {
    // DebouncedEvent is a struct that wraps the underlying notify::Event
    // We can check its paths field to determine if the event should be forwarded
    event
        .paths
        .iter()
        .all(|path| path_allowed(path, gi, canonical_root))
}

pub fn async_watcher(
    root: PathBuf,
) -> Result<
    (
        Debouncer<RecommendedWatcher, RecommendedCache>,
        Receiver<DebounceEventResult>,
        PathBuf,
    ),
    FilesystemWatcherError,
> {
    let canonical_root = canonicalize_lossy(&root);
    let gi_set = Arc::new(build_gitignore_set(&canonical_root)?);
    let (mut tx, rx) = channel(64); // Increased capacity for error bursts

    let gi_clone = gi_set.clone();
    let root_clone = canonical_root.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(200),
        None, // Use default config
        move |res: DebounceEventResult| {
            match res {
                Ok(events) => {
                    // Filter events and only send allowed ones
                    let filtered_events: Vec<DebouncedEvent> = events
                        .into_iter()
                        .filter(|ev| debounced_should_forward(ev, &gi_clone, &root_clone))
                        .collect();

                    if !filtered_events.is_empty() {
                        let filtered_result = Ok(filtered_events);
                        futures::executor::block_on(async {
                            tx.send(filtered_result).await.ok();
                        });
                    }
                }
                Err(errors) => {
                    // Always forward errors
                    futures::executor::block_on(async {
                        tx.send(Err(errors)).await.ok();
                    });
                }
            }
        },
    )?;

    // Start watching the root directory
    debouncer.watch(&canonical_root, RecursiveMode::Recursive)?;

    Ok((debouncer, rx, canonical_root))
}

async fn async_watch<P: AsRef<Path>>(path: P) -> Result<(), FilesystemWatcherError> {
    let (_debouncer, mut rx, _canonical_path) = async_watcher(path.as_ref().to_path_buf())?;

    // The debouncer is already watching the path, no need to call watch() again

    while let Some(res) = rx.next().await {
        match res {
            Ok(event) => println!("changed: {event:?}"),
            Err(e) => println!("watch error: {e:?}"),
        }
    }

    Ok(())
}
