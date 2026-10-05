import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema/index.ts',
  out: './drizzle',
  // pg-boss verwaltet sein eigenes Schema `pgboss`; es darf nie in Migrationen landen.
  schemaFilter: ['public'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://tetra:tetra@localhost:5432/tetra'
  }
})
