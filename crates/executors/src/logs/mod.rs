use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod plain_text_processor;
pub mod stderr_processor;
pub mod utils;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum ToolResultValueType {
    Markdown,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolResult {
    pub r#type: ToolResultValueType,
    /// For Markdown, this will be a JSON string; for JSON, a structured value
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum CommandExitStatus {
    ExitCode { code: i32 },
    Success { success: bool },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CommandRunResult {
    pub exit_status: Option<CommandExitStatus>,
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct NormalizedConversation {
    pub entries: Vec<NormalizedEntry>,
    pub session_id: Option<String>,
    pub executor_type: String,
    pub prompt: Option<String>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NormalizedEntryType {
    UserMessage,
    AssistantMessage,
    ToolUse {
        tool_name: String,
        action_type: ActionType,
    },
    SystemMessage,
    ErrorMessage,
    Thinking,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct NormalizedEntry {
    pub timestamp: Option<String>,
    pub entry_type: NormalizedEntryType,
    pub content: String,
    #[ts(skip)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TodoItem {
    pub content: String,
    pub status: String,
    #[serde(default)]
    pub priority: Option<String>,
}

/// Types of tool actions that can be performed
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ActionType {
    FileRead {
        path: String,
    },
    FileEdit {
        path: String,
        changes: Vec<FileChange>,
    },
    CommandRun {
        command: String,
        #[serde(default)]
        result: Option<CommandRunResult>,
    },
    Search {
        query: String,
    },
    WebFetch {
        url: String,
    },
    /// Generic tool with optional arguments and result for rich rendering
    Tool {
        tool_name: String,
        #[serde(default)]
        arguments: Option<serde_json::Value>,
        #[serde(default)]
        result: Option<ToolResult>,
    },
    TaskCreate {
        description: String,
    },
    PlanPresentation {
        plan: String,
    },
    TodoManagement {
        todos: Vec<TodoItem>,
        operation: String,
    },
    Other {
        description: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum FileChange {
    /// Create a file if it doesn't exist, and overwrite its content.
    Write { content: String },
    /// Delete a file.
    Delete,
    /// Rename a file.
    Rename { new_path: String },
    /// Edit a file with a unified diff.
    Edit {
        /// Unified diff containing file header and hunks.
        unified_diff: String,
        /// Whether line number in the hunks are reliable.
        has_line_numbers: bool,
    },
}
