// Resolution shim for consumers using classic `moduleResolution: "Node"`
// (apps/api), which ignores package.json `exports` subpaths. Bundler-resolution
// consumers (apps/web) resolve `@lexdraft/types/messaging` via `exports`.
export * from './src/messaging';
