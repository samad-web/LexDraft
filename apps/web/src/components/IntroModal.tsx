import { useState, type FormEvent } from 'react';
import { Icon } from '@lexdraft/ui';
import { LogoMark } from '@/components/brand/Logo';
import { readIntro, saveIntro, type IntroAnswers, type PracticeSize } from '@/lib/intro';

// First-visit questions on the landing page: "How do you run your practice?"
// then "What's your name?". Answers stay in this browser (lib/intro.ts) and
// personalise the page, pre-fill sign-up and pre-pick the onboarding plan.

const SIZES: Array<{ id: PracticeSize; title: string; sub: string; icon: 'clients' | 'members' | 'building' }> = [
  { id: 'solo', title: 'Just me', sub: 'A solo practice', icon: 'clients' },
  { id: 'team', title: 'A small team', sub: '2 - 8 advocates', icon: 'members' },
  { id: 'firm', title: 'A full firm', sub: '9 or more', icon: 'building' },
];

export function IntroModal({ onDone }: { onDone: (answers: IntroAnswers) => void }) {
  const [size, setSize] = useState<PracticeSize | null>(null);
  const [name, setName] = useState('');

  const close = () => {
    saveIntro({ dismissed: true });
    onDone(readIntro());
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!size || !name.trim()) return;
    saveIntro({ size, name: name.trim() });
    onDone(readIntro());
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How do you run your practice?"
      style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <div style={{ position: 'relative', width: 480, maxWidth: '100%', background: 'var(--bg-base)', color: 'var(--text-primary)', borderRadius: 24, padding: '36px 36px 32px', boxShadow: '0 24px 64px rgba(0,0,0,0.25)', textAlign: 'center' }}>
        <button type="button" onClick={close} aria-label="Close" style={{ position: 'absolute', top: 18, right: 18, border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)', padding: 4 }}>
          <Icon name="close" size={18} />
        </button>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <LogoMark size={52} />
        </div>
        {!size ? (
          <>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>How do you run your practice?</h2>
            <p style={{ fontSize: 15, marginTop: 8, color: 'var(--text-secondary)' }}>So we can show you the right details for you.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSize(s.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border-default)', borderRadius: 14, background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                >
                  <Icon name={s.icon} size={20} />
                  <span>
                    <span style={{ display: 'block', fontSize: 17, fontWeight: 600 }}>{s.title}</span>
                    <span style={{ display: 'block', fontSize: 14, color: 'var(--text-secondary)' }}>{s.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Lovely! What&rsquo;s your name?</h2>
            <p style={{ fontSize: 15, marginTop: 8, color: 'var(--text-secondary)' }}>We&rsquo;ll set this page up just for you.</p>
            <input
              className="input"
              autoFocus
              autoComplete="name"
              aria-label="Your name"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ marginTop: 24, height: 56, fontSize: 18, textAlign: 'center', borderRadius: 14 }}
            />
            <button type="submit" className="btn btn-primary btn-lg btn-block btn-pill" disabled={!name.trim()} style={{ marginTop: 16, height: 54, opacity: name.trim() ? 1 : 0.5 }}>
              Continue <Icon name="arrow" size={14} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setSize(null)}>Back</button>
          </form>
        )}
      </div>
    </div>
  );
}
