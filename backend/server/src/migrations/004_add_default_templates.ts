import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // デフォルトのグローバルテンプレートを作成
  const defaultTemplates = [
    {
      id: Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))),
      project_id: null, // Global template
      title: 'Fix Bug',
      description: 'Identify and fix a bug in the codebase. Include steps to reproduce, root cause analysis, and testing.',
      template_name: 'fix-bug',
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))),
      project_id: null,
      title: 'Add Feature',
      description: 'Implement a new feature. Include requirements analysis, design considerations, and comprehensive testing.',
      template_name: 'add-feature',
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))),
      project_id: null,
      title: 'Refactor Code',
      description: 'Refactor existing code to improve readability, performance, or maintainability. Ensure no functional changes.',
      template_name: 'refactor-code',
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))),
      project_id: null,
      title: 'Write Tests',
      description: 'Write comprehensive tests for existing functionality. Include unit tests, integration tests, and edge cases.',
      template_name: 'write-tests',
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))),
      project_id: null,
      title: 'Update Documentation',
      description: 'Update project documentation including README, API docs, and inline comments.',
      template_name: 'update-docs',
      created_at: new Date(),
      updated_at: new Date()
    }
  ];
  
  await knex('task_templates').insert(defaultTemplates);
}

export async function down(knex: Knex): Promise<void> {
  // デフォルトテンプレートを削除
  await knex('task_templates')
    .whereNull('project_id')
    .whereIn('template_name', ['fix-bug', 'add-feature', 'refactor-code', 'write-tests', 'update-docs'])
    .del();
}
