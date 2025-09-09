import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { 
  Project, 
  CreateProject, 
  UpdateProject, 
  ProjectWithBranch, 
  ProjectError,
  SearchResult,
  SearchMatchType
} from './types';

export class ProjectModel {
  constructor(private db: Knex) {}

  private uuidToBuffer(uuid: string): Buffer {
    if (!uuid || typeof uuid !== 'string') {
      throw new Error(`Invalid UUID: expected string, got ${typeof uuid}`);
    }
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

  private mapDbToProject(row: any): Project {
    return {
      id: this.bufferToUuid(row.id),
      name: row.name,
      git_repo_path: row.git_repo_path,
      setup_script: row.setup_script || undefined,
      dev_script: row.dev_script || undefined,
      cleanup_script: row.cleanup_script || undefined,
      copy_files: row.copy_files || undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  async findAll(): Promise<Project[]> {
    const rows = await this.db('projects')
      .select('*')
      .orderBy('created_at', 'desc');
    
    return rows.map(row => this.mapDbToProject(row));
  }

  async findById(id: string): Promise<Project | null> {
    if (!id || typeof id !== 'string') {
      console.error(`Invalid project ID provided: ${id} (type: ${typeof id})`);
      return null;
    }
    
    try {
      const row = await this.db('projects')
        .where('id', this.uuidToBuffer(id))
        .first();
      
      return row ? this.mapDbToProject(row) : null;
    } catch (error) {
      console.error(`Error finding project by ID ${id}:`, error);
      return null;
    }
  }

  async findByGitRepoPath(gitRepoPath: string): Promise<Project | null> {
    const row = await this.db('projects')
      .where('git_repo_path', gitRepoPath)
      .first();
    
    return row ? this.mapDbToProject(row) : null;
  }

  async findByGitRepoPathExcludingId(gitRepoPath: string, excludeId: string): Promise<Project | null> {
    const row = await this.db('projects')
      .where('git_repo_path', gitRepoPath)
      .whereNot('id', this.uuidToBuffer(excludeId))
      .first();
    
    return row ? this.mapDbToProject(row) : null;
  }

  async create(data: CreateProject): Promise<Project> {
    const projectId = uuidv4();
    const now = new Date();

    // Check if git_repo_path already exists
    const existing = await this.findByGitRepoPath(data.git_repo_path);
    if (existing) {
      throw new ProjectError('Project with git repository path already exists', 'GIT_REPO_PATH_EXISTS');
    }

    await this.db('projects').insert({
      id: this.uuidToBuffer(projectId),
      name: data.name,
      git_repo_path: data.git_repo_path,
      setup_script: data.setup_script || '',
      dev_script: data.dev_script || '',
      cleanup_script: data.cleanup_script || '',
      copy_files: data.copy_files || null,
      created_at: now,
      updated_at: now
    });

    const project = await this.findById(projectId);
    if (!project) {
      throw new ProjectError('Failed to create project', 'CREATE_FAILED');
    }

    return project;
  }

  async update(
    id: string,
    name: string,
    gitRepoPath: string,
    setupScript?: string,
    devScript?: string,
    cleanupScript?: string,
    copyFiles?: string
  ): Promise<Project> {
    // Check if the project exists
    const existing = await this.findById(id);
    if (!existing) {
      throw new ProjectError('Project not found', 'PROJECT_NOT_FOUND');
    }

    // Check if git_repo_path conflicts with another project
    const conflicting = await this.findByGitRepoPathExcludingId(gitRepoPath, id);
    if (conflicting) {
      throw new ProjectError('Project with git repository path already exists', 'GIT_REPO_PATH_EXISTS');
    }

    await this.db('projects')
      .where('id', this.uuidToBuffer(id))
      .update({
        name,
        git_repo_path: gitRepoPath,
        setup_script: setupScript || '',
        dev_script: devScript || '',
        cleanup_script: cleanupScript || '',
        copy_files: copyFiles || null,
        updated_at: new Date()
      });

    const project = await this.findById(id);
    if (!project) {
      throw new ProjectError('Failed to update project', 'UPDATE_FAILED');
    }

    return project;
  }

  async delete(id: string): Promise<number> {
    const result = await this.db('projects')
      .where('id', this.uuidToBuffer(id))
      .del();
    
    return result;
  }

  async exists(id: string): Promise<boolean> {
    const result = await this.db('projects')
      .where('id', this.uuidToBuffer(id))
      .count('* as count')
      .first();
    
    return result ? Number(result.count) > 0 : false;
  }

  // Create ProjectWithBranch by adding current branch info
  createProjectWithBranch(project: Project, currentBranch?: string): ProjectWithBranch {
    return {
      ...project,
      current_branch: currentBranch
    };
  }

  // Search functionality (placeholder - would need actual file system search)
  async search(query: string): Promise<SearchResult[]> {
    // This is a placeholder implementation
    // In the actual implementation, this would search the file system
    // within the project's git_repo_path
    return [
      {
        path: `example/${query}`,
        is_file: true,
        match_type: SearchMatchType.FILE_NAME
      }
    ];
  }
}
