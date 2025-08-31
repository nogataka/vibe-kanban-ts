use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, TS, Type)]
#[sqlx(type_name = "merge_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum MergeStatus {
    Open,
    Merged,
    Closed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Merge {
    Direct(DirectMerge),
    Pr(PrMerge),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DirectMerge {
    pub id: Uuid,
    pub task_attempt_id: Uuid,
    pub merge_commit: String,
    pub target_branch_name: String,
    pub created_at: DateTime<Utc>,
}

/// PR merge - represents a pull request merge
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PrMerge {
    pub id: Uuid,
    pub task_attempt_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub target_branch_name: String,
    pub pr_info: PullRequestInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PullRequestInfo {
    pub number: i64,
    pub url: String,
    pub status: MergeStatus,
    pub merged_at: Option<chrono::DateTime<chrono::Utc>>,
    pub merge_commit_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
pub enum MergeType {
    Direct,
    Pr,
}

#[derive(FromRow)]
struct MergeRow {
    id: Uuid,
    task_attempt_id: Uuid,
    merge_type: MergeType,
    merge_commit: Option<String>,
    target_branch_name: String,
    pr_number: Option<i64>,
    pr_url: Option<String>,
    pr_status: Option<MergeStatus>,
    pr_merged_at: Option<DateTime<Utc>>,
    pr_merge_commit_sha: Option<String>,
    created_at: DateTime<Utc>,
}

impl Merge {
    pub fn merge_commit(&self) -> Option<String> {
        match self {
            Merge::Direct(direct) => Some(direct.merge_commit.clone()),
            Merge::Pr(pr) => pr.pr_info.merge_commit_sha.clone(),
        }
    }

    /// Create a direct merge record
    pub async fn create_direct(
        pool: &SqlitePool,
        task_attempt_id: Uuid,
        target_branch_name: &str,
        merge_commit: &str,
    ) -> Result<DirectMerge, sqlx::Error> {
        let id = Uuid::new_v4();
        let now = Utc::now();

        sqlx::query_as!(
            MergeRow,
            r#"INSERT INTO merges (
                id, task_attempt_id, merge_type, merge_commit, created_at, target_branch_name
            ) VALUES ($1, $2, 'direct', $3, $4, $5)
            RETURNING 
                id as "id!: Uuid",
                task_attempt_id as "task_attempt_id!: Uuid",
                merge_type as "merge_type!: MergeType",
                merge_commit,
                pr_number,
                pr_url,
                pr_status as "pr_status?: MergeStatus",
                pr_merged_at as "pr_merged_at?: DateTime<Utc>",
                pr_merge_commit_sha,
                created_at as "created_at!: DateTime<Utc>",
                target_branch_name as "target_branch_name!: String"
            "#,
            id,
            task_attempt_id,
            merge_commit,
            now,
            target_branch_name
        )
        .fetch_one(pool)
        .await
        .map(Into::into)
    }
    /// Create a new PR record (when PR is opened)
    pub async fn create_pr(
        pool: &SqlitePool,
        task_attempt_id: Uuid,
        target_branch_name: &str,
        pr_number: i64,
        pr_url: &str,
    ) -> Result<PrMerge, sqlx::Error> {
        let id = Uuid::new_v4();
        let now = Utc::now();

        sqlx::query_as!(
            MergeRow,
            r#"INSERT INTO merges (
                id, task_attempt_id, merge_type, pr_number, pr_url, pr_status, created_at, target_branch_name
            ) VALUES ($1, $2, 'pr', $3, $4, 'open', $5, $6)
            RETURNING 
                id as "id!: Uuid",
                task_attempt_id as "task_attempt_id!: Uuid",
                merge_type as "merge_type!: MergeType",
                merge_commit,
                pr_number,
                pr_url,
                pr_status as "pr_status?: MergeStatus",
                pr_merged_at as "pr_merged_at?: DateTime<Utc>",
                pr_merge_commit_sha,
                created_at as "created_at!: DateTime<Utc>",
                target_branch_name as "target_branch_name!: String"
            "#,
            id,
            task_attempt_id,
            pr_number,
            pr_url,
            now,
            target_branch_name
        )
        .fetch_one(pool)
        .await
        .map(Into::into)
    }

    /// Get all open PRs for monitoring
    pub async fn get_open_prs(pool: &SqlitePool) -> Result<Vec<PrMerge>, sqlx::Error> {
        let rows = sqlx::query_as!(
            MergeRow,
            r#"SELECT 
                id as "id!: Uuid",
                task_attempt_id as "task_attempt_id!: Uuid",
                merge_type as "merge_type!: MergeType",
                merge_commit,
                pr_number,
                pr_url,
                pr_status as "pr_status?: MergeStatus",
                pr_merged_at as "pr_merged_at?: DateTime<Utc>",
                pr_merge_commit_sha,
                created_at as "created_at!: DateTime<Utc>",
                target_branch_name as "target_branch_name!: String"
               FROM merges 
               WHERE merge_type = 'pr' AND pr_status = 'open'
               ORDER BY created_at DESC"#,
        )
        .fetch_all(pool)
        .await?;

        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Update PR status for a task attempt
    pub async fn update_status(
        pool: &SqlitePool,
        merge_id: Uuid,
        pr_status: MergeStatus,
        merge_commit_sha: Option<String>,
    ) -> Result<(), sqlx::Error> {
        let merged_at = if matches!(pr_status, MergeStatus::Merged) {
            Some(Utc::now())
        } else {
            None
        };

        sqlx::query!(
            r#"UPDATE merges 
            SET pr_status = $1, 
                pr_merge_commit_sha = $2,
                pr_merged_at = $3
            WHERE id = $4"#,
            pr_status,
            merge_commit_sha,
            merged_at,
            merge_id
        )
        .execute(pool)
        .await?;

        Ok(())
    }
    /// Find all merges for a task attempt (returns both direct and PR merges)
    pub async fn find_by_task_attempt_id(
        pool: &SqlitePool,
        task_attempt_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        // Get raw data from database
        let rows = sqlx::query_as!(
            MergeRow,
            r#"SELECT 
                id as "id!: Uuid",
                task_attempt_id as "task_attempt_id!: Uuid",
                merge_type as "merge_type!: MergeType",
                merge_commit,
                pr_number,
                pr_url,
                pr_status as "pr_status?: MergeStatus",
                pr_merged_at as "pr_merged_at?: DateTime<Utc>",
                pr_merge_commit_sha,
                target_branch_name as "target_branch_name!: String",
                created_at as "created_at!: DateTime<Utc>"
            FROM merges 
            WHERE task_attempt_id = $1
            ORDER BY created_at DESC"#,
            task_attempt_id
        )
        .fetch_all(pool)
        .await?;

        // Convert to appropriate types based on merge_type
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Find the most recent merge for a task attempt
    pub async fn find_latest_by_task_attempt_id(
        pool: &SqlitePool,
        task_attempt_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        Self::find_by_task_attempt_id(pool, task_attempt_id)
            .await
            .map(|mut merges| merges.pop())
    }
}

// Conversion implementations
impl From<MergeRow> for DirectMerge {
    fn from(row: MergeRow) -> Self {
        DirectMerge {
            id: row.id,
            task_attempt_id: row.task_attempt_id,
            merge_commit: row
                .merge_commit
                .expect("direct merge must have merge_commit"),
            target_branch_name: row.target_branch_name,
            created_at: row.created_at,
        }
    }
}

impl From<MergeRow> for PrMerge {
    fn from(row: MergeRow) -> Self {
        PrMerge {
            id: row.id,
            task_attempt_id: row.task_attempt_id,
            target_branch_name: row.target_branch_name,
            pr_info: PullRequestInfo {
                number: row.pr_number.expect("pr merge must have pr_number"),
                url: row.pr_url.expect("pr merge must have pr_url"),
                status: row.pr_status.expect("pr merge must have status"),
                merged_at: row.pr_merged_at,
                merge_commit_sha: row.pr_merge_commit_sha,
            },
            created_at: row.created_at,
        }
    }
}

impl From<MergeRow> for Merge {
    fn from(row: MergeRow) -> Self {
        match row.merge_type {
            MergeType::Direct => Merge::Direct(DirectMerge::from(row)),
            MergeType::Pr => Merge::Pr(PrMerge::from(row)),
        }
    }
}
