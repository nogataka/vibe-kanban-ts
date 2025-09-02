import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('task_templates', (table) => {
    table.specificType('id', 'BLOB').primary(); // 16-byte binary UUID
    table.specificType('project_id', 'BLOB').nullable(); // null for global templates
    table.text('title').notNullable();
    table.text('description').nullable();
    table.text('template_name').notNullable();
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    
    // Foreign key constraints
    table.foreign('project_id').references('id').inTable('projects').onDelete('CASCADE');
    
    // Indexes
    table.index('project_id');
    table.index('template_name');
    table.index(['project_id', 'template_name']); // Composite index for common queries
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('task_templates');
}
