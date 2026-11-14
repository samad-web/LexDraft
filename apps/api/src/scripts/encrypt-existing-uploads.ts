// =============================================================================
// encrypt-existing-uploads — one-time: encrypt documents saved to the local
// storage dir before file encryption shipped (see lib/field-crypto.ts
// encryptFile). The app already reads both encrypted and legacy plaintext
// files, so this can run any time after the deploy, and re-runs skip files
// that are already encrypted.
//
// Each file is encrypted to a temp file, decrypted back and compared with the
// original, and only then renamed over it, so a crash or a bad key can never
// leave a document unreadable. Dry run by default.
//
//   dry run:  npx tsx src/scripts/encrypt-existing-uploads.ts
//   apply:    npx tsx src/scripts/encrypt-existing-uploads.ts --apply
// =============================================================================
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env';
import { decryptFile, encryptFile, isEncryptedFile } from '../lib/field-crypto';

const apply = process.argv.includes('--apply');

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && !e.name.endsWith('.meta') && !e.name.endsWith('.enc-tmp')) yield p;
  }
}

async function main(): Promise<void> {
  const key = env.fieldEncryptionKey;
  if (!key) throw new Error('FIELD_ENCRYPTION_KEY is not set');
  const root = path.resolve(env.STORAGE_LOCAL_DIR);
  let done = 0, skipped = 0, failed = 0;
  for await (const file of walk(root)) {
    const plain = await fs.readFile(file);
    if (isEncryptedFile(plain)) { skipped++; continue; }
    if (!apply) { done++; continue; }
    const tmp = `${file}.enc-tmp`;
    try {
      const sealed = encryptFile(plain, key);
      if (!decryptFile(sealed, key).equals(plain)) throw new Error('verify mismatch');
      await fs.writeFile(tmp, sealed);
      if (!decryptFile(await fs.readFile(tmp), key).equals(plain)) throw new Error('verify mismatch after write');
      await fs.rename(tmp, file);
      done++;
    } catch (err) {
      failed++;
      await fs.rm(tmp, { force: true });
      console.error(`FAILED ${path.relative(root, file)}: ${(err as Error).message}`);
    }
  }
  console.log(`${apply ? 'Encrypted' : 'Would encrypt'}: ${done}; already encrypted: ${skipped}; failed: ${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
