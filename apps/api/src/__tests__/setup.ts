// Test-time env defaults so `env.ts` doesn't bail on missing JWT_SECRET when
// the suite runs without a `.env` file. Set BEFORE any `import { env }` runs.
process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] || 'test-secret-32-bytes-minimum-aaaaaaaa';
process.env['DATABASE_URL'] = process.env['DATABASE_URL'] || '';
process.env['STORAGE_DRIVER'] = process.env['STORAGE_DRIVER'] || 'local';
process.env['STORAGE_LOCAL_DIR'] = process.env['STORAGE_LOCAL_DIR'] || './.test-uploads';
process.env['STORAGE_PUBLIC_BASE_URL'] = process.env['STORAGE_PUBLIC_BASE_URL'] || 'http://localhost:4000';
process.env['STORAGE_SIGNING_SECRET'] = process.env['STORAGE_SIGNING_SECRET'] || 'storage-test-secret-32-bytes-min-x';
// Existing test suites lean on the legacy `signIn → auto-provision`
// shortcut to build fixtures. Production rejects unknown emails by
// default; tests are NODE_ENV='test' so flipping this on here only
// affects the suite, never the deployed binary.
process.env['DEV_AUTH_AUTO_PROVISION'] = process.env['DEV_AUTH_AUTO_PROVISION'] || 'true';
