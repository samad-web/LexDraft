import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from '@lexdraft/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// build-docs/features/app-handoff-and-renewal-reminders.md (AC1, AC4).
const env = vi.hoisted(() => ({ native: false }));
vi.mock('@capacitor/core', async (orig) => {
  const real = await orig<typeof import('@capacitor/core')>();
  return { ...real, Capacitor: { ...real.Capacitor, isNativePlatform: () => env.native } };
});

import { PLAY_STORE_URL } from '../play-policy';
import { useAuthStore } from '@/store/auth';
import { GetTheApp } from '@/components/GetTheApp';

const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const signIn = (user: Partial<User> | null) => { (useAuthStore.getInitialState() as { user: User | null }).user = user as User | null; };
beforeEach(() => { env.native = false; });
afterEach(() => signIn(null));

describe('AC1 after paying on the website: get the app', () => {
  it('links to the Play listing and names the account email to sign in with', () => {
    signIn({ email: 'asha@example.in' });
    const html = renderToStaticMarkup(<GetTheApp />);
    expect(PLAY_STORE_URL).toBe('https://play.google.com/store/apps/details?id=in.sirahdigital.difai');
    expect(html).toContain(`href="${PLAY_STORE_URL}"`);
    expect(html).toContain('Get the DifAi app on Google Play');
    expect(html).toContain('Sign in with the same account (asha@example.in)');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toMatch(/<img|<svg/); // plain link, not Google's badge artwork
  });

  it('hidden in the Android app', () => {
    env.native = true;
    signIn({ email: 'asha@example.in' });
    expect(renderToStaticMarkup(<GetTheApp />)).toBe('');
  });

  it('shown on the payment return (done / paid) once the plan is active', () => {
    expect(src('views/BillingView.tsx')).toMatch(/\(returned === 'done' \|\| returned === 'paid'\) && paid && <GetTheApp \/>/);
  });
});

describe('AC4 landing: Get the Android app', () => {
  it('the website footer links to the Play listing (the landing never renders in the app)', () => {
    expect(src('views/LandingView.tsx')).toMatch(/label: 'Get the Android app', href: PLAY_STORE_URL/);
    expect(src('App.tsx')).toMatch(/isNativePlatform\(\)[\s\S]{0,120}<AppWelcomeView \/>\)\s*:\s*<LandingView \/>/);
  });
});
