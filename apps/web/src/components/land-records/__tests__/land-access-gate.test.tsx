/** land-records-tn-gate.md AC1-AC4 (screen): what each access status shows. */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LandAccess } from '@lexdraft/types';

const h = vi.hoisted(() => ({ access: null as LandAccess | null }));
vi.mock('@/hooks/useLandAccess', () => ({
  useLandAccess: () => ({ isLoading: false, isError: false, data: h.access }),
  useSaveLandState: () => ({ mutate: () => undefined, isPending: false, isError: false }),
}));
vi.mock('@/components/PageHeader', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));

import { LandAccessGate } from '../LandAccessGate';

const render = (a: LandAccess) => { h.access = a; return renderToStaticMarkup(<LandAccessGate><p>SERVICES</p></LandAccessGate>); };

describe('LandAccessGate', () => {
  it('AC1 Tamil Nadu: the services', () => {
    expect(render({ status: 'available', state: 'Tamil Nadu' })).toBe('<p>SERVICES</p>');
  });
  it('AC2 no state: asks which state, lists Tamil Nadu, no services', () => {
    const html = render({ status: 'state_required', state: null });
    expect(html).toContain('Which state do you practise in?');
    expect(html).toContain('>Tamil Nadu</option>');
    expect(html).not.toContain('SERVICES');
  });
  it('AC3 other state: coming soon, names the state, can change it', () => {
    const html = render({ status: 'coming_soon', state: 'Kerala' });
    expect(html).toContain('Land Records for Kerala is coming soon');
    expect(html).toContain('Change state');
    expect(html).not.toContain('SERVICES');
  });
  it('AC4 switched off', () => {
    expect(render({ status: 'disabled', state: 'Tamil Nadu' })).toContain('switched off');
  });
});
