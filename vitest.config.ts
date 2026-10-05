import { defineVitestConfig } from '@nuxt/test-utils/config'

// Unit-Tests laufen ohne Postgres; *.db.test.ts nutzen TEST_DATABASE_URL (siehe tests/helpers/db.ts).
export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    include: ['tests/**/*.test.ts'],
    hookTimeout: 60000,
    testTimeout: 30000
  }
})
