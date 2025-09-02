import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tasks', (table) => {
    table.specificType('id', 'BLOB').primary(); // 16-byte binary UUID
    table.specificType('project_id', 'BLOB').notNullable(); // Foreign key to projects
    table.text('title').notNullable();
    table.text('description').nullable();
    table.text('status').notNullable().defaultTo('todo'); // todo, inprogress, inreview, done, cancelled
    table.specificType('parent_task_attempt', 'BLOB').nullable(); // Foreign key to task_attempts
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    
    // Foreign key constraints
    table.foreign('project_id').references('id').inTable('projects').onDelete('CASCADE');
    
    // Indexes
    table.index('project_id');
    table.index('status');
    table.index('created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('tasks');
}
