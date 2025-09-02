import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { 
  Merge,
  MergeType,
  PRStatus
} from './types';

export class MergeModel {
  constructor(private db: Knex) {}

  private uuidToBuffer(uuid: string): Buffer {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex');
  }

  private bufferToUuid(buffer: Buffer): string {
    const hex = buffer.toString('hex');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32)
    ].join('-');
  }

  private mapDbToMerge(row: any): Merge {
    return {
      id: this.bufferToUuid(row.id),
      task_attempt_id: this.bufferToUuid(row.task_attempt_id),
      merge_type: row.merge_type as MergeType,
      merge_commit: row.merge_commit || undefined,
      pr_number: row.pr_number || undefined,
      pr_url: row.pr_url || undefined,
      pr_status: row.pr_status as PRStatus || undefined,
      pr_merged_at: row.pr_merged_at ? new Date(row.pr_merged_at) : undefined,
      pr_merge_commit_sha: row.pr_merge_commit_sha || undefined,
      created_at: new Date(row.created_at),
      target_branch_name: row.target_branch_name
    };
  }

  async findById(id: string): Promise<Merge | null> {
    const row = await this.db('merges')
      .where('id', this.uuidToBuffer(id))
      .first();
    
    return row ? this.mapDbToMerge(row) : null;
  }

  async findByTaskAttemptId(taskAttemptId: string): Promise<Merge[]> {
    const rows = await this.db('merges')
      .where('task_attempt_id', this.uuidToBuffer(taskAttemptId))
      .orderBy('created_at', 'desc');
    
    return rows.map(row => this.mapDbToMerge(row));
  }

  async findOpenPRByTaskAttemptId(taskAttemptId: string): Promise<Merge | null> {
    const row = await this.db('merges')
      .where('task_attempt_id', this.uuidToBuffer(taskAttemptId))
      .where('merge_type', MergeType.PR)
      .where('pr_status', PRStatus.OPEN)
      .first();
    
    return row ? this.mapDbToMerge(row) : null;
  }

  async createDirectMerge(
    taskAttemptId: string,
    mergeCommit: string,
    targetBranchName: string
  ): Promise<Merge> {
    const mergeId = uuidv4();
    const now = new Date();

    await this.db('merges').insert({
      id: this.uuidToBuffer(mergeId),
      task_attempt_id: this.uuidToBuffer(taskAttemptId),
      merge_type: MergeType.DIRECT,
      merge_commit: mergeCommit,
      pr_number: null,
      pr_url: null,
      pr_status: null,
      pr_merged_at: null,
      pr_merge_commit_sha: null,
      created_at: now,
      target_branch_name: targetBranchName
    });

    const merge = await this.findById(mergeId);
    if (!merge) {
      throw new Error('Failed to create direct merge');
    }

    return merge;
  }

  async createPRMerge(
    taskAttemptId: string,
    prNumber: number,
    prUrl: string,
    targetBranchName: string,
    prStatus: PRStatus = PRStatus.OPEN
  ): Promise<Merge> {
    const mergeId = uuidv4();
    const now = new Date();

    await this.db('merges').insert({
      id: this.uuidToBuffer(mergeId),
      task_attempt_id: this.uuidToBuffer(taskAttemptId),
      merge_type: MergeType.PR,
      merge_commit: null,
      pr_number: prNumber,
      pr_url: prUrl,
      pr_status: prStatus,
      pr_merged_at: null,
      pr_merge_commit_sha: null,
      created_at: now,
      target_branch_name: targetBranchName
    });

    const merge = await this.findById(mergeId);
    if (!merge) {
      throw new Error('Failed to create PR merge');
    }

    return merge;
  }

  async updatePRStatus(
    id: string,
    prStatus: PRStatus,
    mergedAt?: Date,
    mergeCommitSha?: string
  ): Promise<Merge> {
    await this.db('merges')
      .where('id', this.uuidToBuffer(id))
      .update({
        pr_status: prStatus,
        pr_merged_at: mergedAt || null,
        pr_merge_commit_sha: mergeCommitSha || null
      });

    const merge = await this.findById(id);
    if (!merge) {
      throw new Error('Merge not found after update');
    }

    return merge;
  }

  async delete(id: string): Promise<number> {
    const result = await this.db('merges')
      .where('id', this.uuidToBuffer(id))
      .del();
    
    return result;
  }

  async findByPRNumber(prNumber: number): Promise<Merge | null> {
    const row = await this.db('merges')
      .where('pr_number', prNumber)
      .where('merge_type', MergeType.PR)
      .first();
    
    return row ? this.mapDbToMerge(row) : null;
  }

  async findOpenPRs(): Promise<Merge[]> {
    const rows = await this.db('merges')
      .where('merge_type', MergeType.PR)
      .where('pr_status', PRStatus.OPEN)
      .orderBy('created_at', 'desc');
    
    return rows.map(row => this.mapDbToMerge(row));
  }
}
