import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// team-docs presence: "Priya is working on this now".
export type Working = Record<string, Array<{ userId: string; name: string }>>;
const BEAT_MS = 25_000;

/** While this screen is open, tell the team you're working on `targets`
 *  (e.g. ['doc:<id>']); returns who ELSE is on them. Stops on close. */
export function useWorkingOn(targets: string[] | null): Working {
  const [others, setOthers] = useState<Working>({});
  const key = targets?.filter(Boolean).join(',') ?? '';
  useEffect(() => {
    if (!key) return;
    const list = key.split(',');
    let stopped = false;
    const beat = () => {
      if (document.visibilityState === 'hidden') return;
      api.post<{ working: Working }>('/presence', { targets: list })
        .then((r) => { if (!stopped) setOthers(r.working ?? {}); })
        .catch(() => undefined);
    };
    beat();
    const t = setInterval(beat, BEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', beat);
      api.post('/presence/leave', { targets: list }).catch(() => undefined);
    };
  }, [key]);
  return others;
}

/** Who is working on what across the firm (for lists), refreshed every 30 s. */
export function useFirmWorking(enabled = true): Working {
  const q = useQuery({
    queryKey: ['presence'],
    queryFn: () => api.get<{ working: Working }>('/presence').then((r) => r.working ?? {}),
    refetchInterval: 30_000,
    enabled,
    staleTime: 20_000,
  });
  return q.data ?? {};
}

/** "Priya is working on this now" / "Priya and Anand are…" for any of `targets`. */
export function workingLine(w: Working, targets: string[]): string {
  const seen = new Map<string, string>();
  for (const t of targets) for (const p of w[t] ?? []) seen.set(p.userId, p.name);
  const n = [...seen.values()];
  if (!n.length) return '';
  const who = n.length === 1 ? n[0] : n.length === 2 ? `${n[0]} and ${n[1]}` : `${n[0]} and ${n.length - 1} others`;
  return `${who} ${n.length === 1 ? 'is' : 'are'} working on this now`;
}
