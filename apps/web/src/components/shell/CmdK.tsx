import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Case, Client, Lead } from '@lexdraft/types';
import { Icon, type IconName } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { NAV_GROUPS } from './nav-config';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: IconName;
  /** Hint shown on the right (e.g. shortcut, target route). */
  hint?: ReactNode;
  run: () => void;
}

const RECENT_KEY = 'lexdraft.cmdk.recent';
const MAX_RECENT = 5;

function loadRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecent(id: string, current: string[]): void {
  const next = [id, ...current.filter((x) => x !== id)].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* swallow */
  }
}

export function CmdK() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toggleCmdK = useUIStore((s) => s.toggleCmdK);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const theme = useUIStore((s) => s.theme);
  const [q, setQ] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const listRef = useRef<HTMLDivElement>(null);

  // Pull cached entity lists out of react-query. We don't refetch on
  // open — the user is searching what they've already seen. If they
  // haven't loaded a view yet there's nothing to search there, which
  // is fine; the nav commands still get them to the right place.
  const contentMatches = useMemo<Command[]>(() => {
    if (!q.trim()) return [];
    const needle = q.toLowerCase();
    const matches: Command[] = [];

    // Cases — match title or CNR. The query cache is keyed by ['cases', filter];
    // grab all variants and dedupe by id so partial-filter caches don't multiply hits.
    const seenCases = new Set<string>();
    for (const entry of qc.getQueriesData<{ items: Case[] } | undefined>({ queryKey: ['cases'] })) {
      const data = entry[1];
      if (!data?.items) continue;
      for (const c of data.items) {
        if (seenCases.has(c.id)) continue;
        if (c.title.toLowerCase().includes(needle) || (c.cnr ?? '').toLowerCase().includes(needle)) {
          seenCases.add(c.id);
          matches.push({
            id: `case.${c.id}`,
            label: c.title,
            group: 'Cases',
            icon: 'cases',
            hint: <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{c.cnr || c.type}</span>,
            run: () => navigate(`/app/cases/${c.id}`),
          });
        }
      }
    }

    // Leads — match name or referrer.
    const leadsData = qc.getQueryData<{ items: Lead[] }>(['leads']);
    if (leadsData?.items) {
      for (const l of leadsData.items) {
        if (l.name.toLowerCase().includes(needle) || (l.referrer ?? '').toLowerCase().includes(needle)) {
          matches.push({
            id: `lead.${l.id}`,
            label: l.name,
            group: 'Leads',
            icon: 'leads',
            hint: <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{l.stage}</span>,
            run: () => navigate('/app/leads'),
          });
        }
      }
    }

    // Clients — match name or email.
    const clientsData = qc.getQueryData<Client[]>(['clients']);
    if (Array.isArray(clientsData)) {
      for (const cl of clientsData) {
        if (cl.name.toLowerCase().includes(needle) || (cl.email ?? '').toLowerCase().includes(needle)) {
          matches.push({
            id: `client.${cl.id}`,
            label: cl.name,
            group: 'Clients',
            icon: 'clients',
            hint: <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{cl.type}</span>,
            run: () => navigate('/app/clients'),
          });
        }
      }
    }

    return matches.slice(0, 20); // cap so the list stays scannable
  }, [q, qc, navigate]);

  // All registered commands. Nav items expand into one Command per item;
  // actions live alongside (theme toggle, sign out, etc.).
  const all: Command[] = useMemo(() => {
    const navCommands: Command[] = NAV_GROUPS.flatMap((g) =>
      g.items.map((i) => ({
        id: `nav.${i.id}`,
        label: i.label,
        group: g.title,
        icon: i.icon,
        hint: <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{i.to}</span>,
        run: () => navigate(i.to),
      })),
    );
    const actions: Command[] = [
      {
        id: 'action.toggle-theme',
        label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        group: 'Preferences',
        icon: theme === 'dark' ? 'sun' : 'moon',
        run: () => toggleTheme(),
      },
      {
        id: 'action.settings',
        label: 'Open settings',
        group: 'Preferences',
        icon: 'settings',
        run: () => navigate('/app/settings'),
      },
    ];
    return [...navCommands, ...actions];
  }, [navigate, toggleTheme, theme]);

  const filtered: Command[] = useMemo(() => {
    if (!q.trim()) {
      // Surface recent items first when the query is empty.
      if (recent.length === 0) return all;
      const recents = recent
        .map((id) => all.find((c) => c.id === id))
        .filter((c): c is Command => c !== undefined)
        .map((c) => ({ ...c, group: 'Recent' }));
      const recentIds = new Set(recents.map((c) => c.id));
      return [...recents, ...all.filter((c) => !recentIds.has(c.id))];
    }
    const needle = q.toLowerCase();
    const commandMatches = all.filter(
      (c) => c.label.toLowerCase().includes(needle) || c.group.toLowerCase().includes(needle),
    );
    // Always offer to search the Indian-law corpus with whatever the user
    // typed. Surfaces BELOW direct content matches (cases/clients/leads)
    // but ABOVE generic nav so it's reachable in two keystrokes when no
    // exact entity hit exists.
    const lawSearch: Command = {
      id: 'action.search-laws',
      label: `Search Indian law: "${q.trim()}"`,
      group: 'Research',
      icon: 'research',
      hint: <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>statutes & sections</span>,
      run: () => navigate(`/app/research?mode=corpus&q=${encodeURIComponent(q.trim())}`),
    };
    // Content matches surface ABOVE nav/action matches so when the user
    // types a known case/client name the right entity is the first hit.
    return [...contentMatches, lawSearch, ...commandMatches];
  }, [q, all, recent, contentMatches, navigate]);

  // Reset highlight when the result set changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [filtered.length, q]);

  function execute(cmd: Command): void {
    const nextRecent = [cmd.id, ...recent.filter((x) => x !== cmd.id)].slice(0, MAX_RECENT);
    setRecent(nextRecent);
    saveRecent(cmd.id, recent);
    cmd.run();
    toggleCmdK(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleCmdK(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[activeIdx];
        if (cmd) execute(cmd);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // execute closes over state; we want the freshest copy each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, activeIdx]);

  // Keep the highlighted row visible as the user arrow-keys past the fold.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  return (
    <>
      <div
        onClick={() => toggleCmdK(false)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 100,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmdk-input"
        style={{
          position: 'fixed',
          top: '15vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(640px, 92vw)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-modal)',
          zIndex: 101,
          overflow: 'hidden',
        }}
      >
        <div className="row" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', gap: 12 }}>
          <Icon name="search" size={16} />
          <input
            id="cmdk-input"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command or search…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 0,
              outline: 0,
              fontSize: 15,
              color: 'var(--text-primary)',
            }}
            aria-controls="cmdk-list"
            aria-activedescendant={`cmdk-item-${activeIdx}`}
          />
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>ESC</span>
        </div>
        <div
          ref={listRef}
          id="cmdk-list"
          role="listbox"
          style={{ maxHeight: 400, overflowY: 'auto', padding: 8 }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: 28, textAlign: 'center' }} className="muted body-sm">
              No matches
            </div>
          )}
          {filtered.map((c, idx) => {
            const isActive = idx === activeIdx;
            return (
              <button
                key={c.id}
                id={`cmdk-item-${idx}`}
                role="option"
                aria-selected={isActive}
                data-idx={idx}
                onClick={() => execute(c)}
                onMouseMove={() => setActiveIdx(idx)}
                className="row"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  background: isActive ? 'var(--bg-surface)' : 'transparent',
                  color: 'var(--text-primary)',
                  gap: 12,
                  border: 0,
                  textAlign: 'left',
                }}
              >
                <Icon name={c.icon} size={16} />
                <span style={{ flex: 1, textAlign: 'left' }}>{c.label}</span>
                <span className="eyebrow">{c.group}</span>
              </button>
            );
          })}
        </div>
        <div
          className="row"
          style={{
            padding: '8px 14px',
            borderTop: '1px solid var(--border-subtle)',
            gap: 12,
            fontSize: 11,
            color: 'var(--text-tertiary)',
          }}
        >
          <span><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> navigate</span>
          <span><kbd className="kbd">Enter</kbd> select</span>
          <span style={{ flex: 1 }} />
          <span>{filtered.length} results</span>
        </div>
      </div>
    </>
  );
}
