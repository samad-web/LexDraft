#!/usr/bin/env node
// Publish the DifAi Android app to Google Play through the Play Developer API.
// No dependencies: the service-account JWT is signed with node:crypto.
//
//   node scripts/play-publish.mjs --track internal --aab path/to/app.aab --notes "..."
//   node scripts/play-publish.mjs --track production --version-code 13 --fraction 0.2 --notes "..."
//   node scripts/play-publish.mjs --status            (print every track's releases)
//
// Key: PLAY_SERVICE_ACCOUNT, else ~/Android/play-service-account.json (never in the repo).
// The service account only has release permissions on DifAi (Play Console, 2026-11-04).

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const PACKAGE = 'in.sirahdigital.difai';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;

const { values: args } = parseArgs({
  options: {
    track: { type: 'string' },
    aab: { type: 'string' },
    'version-code': { type: 'string' },
    fraction: { type: 'string' },
    notes: { type: 'string' },
    status: { type: 'boolean' },
  },
});

async function accessToken() {
  const keyPath = process.env.PLAY_SERVICE_ACCOUNT || join(homedir(), 'Android', 'play-service-account.json');
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token: ${res.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

const token = await accessToken();

async function call(method, url, body, contentType = 'application/json') {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url.replace(API, '').replace(UPLOAD, '')}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const edit = await call('POST', `${API}/edits`, {});
const E = `${API}/edits/${edit.id}`;

try {
  if (args.status) {
    const { tracks } = await call('GET', `${E}/tracks`);
    for (const t of tracks ?? []) {
      for (const r of t.releases ?? []) {
        console.log(`${t.track}: ${r.name ?? ''} codes=${(r.versionCodes ?? []).join(',')} ${r.status}${r.userFraction ? ` ${r.userFraction * 100}%` : ''}`);
      }
    }
    await call('DELETE', E);
    process.exit(0);
  }

  if (!args.track || !args.notes || !(args.aab || args['version-code'])) {
    throw new Error('need --track, --notes and --aab or --version-code (see header)');
  }
  const fraction = args.fraction ? Number(args.fraction) : undefined;
  if (fraction !== undefined && !(fraction > 0 && fraction < 1)) {
    throw new Error('--fraction must be between 0 and 1 (omit it for a full rollout)');
  }

  let versionCode = args['version-code'];
  if (args.aab) {
    const uploaded = await call('POST', `${UPLOAD}/edits/${edit.id}/bundles?uploadType=media`,
      readFileSync(args.aab), 'application/octet-stream');
    versionCode = String(uploaded.versionCode);
    console.log(`uploaded ${args.aab} as versionCode ${versionCode}`);
  }

  // Release notes must use one of the listing's languages; the default one always is.
  const { defaultLanguage } = await call('GET', `${E}/details`);
  await call('PUT', `${E}/tracks/${args.track}`, {
    track: args.track,
    releases: [{
      versionCodes: [versionCode],
      status: fraction ? 'inProgress' : 'completed',
      ...(fraction ? { userFraction: fraction } : {}),
      releaseNotes: [{ language: defaultLanguage, text: args.notes }],
    }],
  });
  await call('POST', `${E}:commit`);
  console.log(`committed: ${args.track} <- versionCode ${versionCode}${fraction ? ` at ${fraction * 100}%` : ''} (${defaultLanguage} notes)`);
} catch (err) {
  await call('DELETE', E).catch(() => {});
  console.error(err.message);
  process.exit(1);
}
