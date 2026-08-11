import { defineConfig } from 'drizzle-kit';

/**
 * Migration generation only. `drizzle-kit generate` diffs the schema and writes SQL; it
 * does not need a live connection. Applying migrations is a deploy step, never a build step.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
});
