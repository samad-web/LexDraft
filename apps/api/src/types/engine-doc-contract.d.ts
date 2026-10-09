// Ambient declaration for the JSON subpath export of @lexdraft/types.
// TypeScript's `resolveJsonModule` doesn't infer types through a package.json
// `exports` map subpath the way it does for a plain relative JSON import, so
// without this the module resolves fine at runtime (Node/pnpm correctly
// follow `exports`) but `tsc` reports TS2307 "Cannot find module".
declare module '@lexdraft/types/engine-doc-contract.json' {
  const value: Record<string, unknown>;
  export default value;
}
