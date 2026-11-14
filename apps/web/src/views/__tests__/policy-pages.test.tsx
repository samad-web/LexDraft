import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ContactView, RefundPolicyView, TermsView } from '../LegalView';

// Razorpay's website review needs refund/cancellation and contact pages with
// the seller's details. Refund rules approved by the owner 2026-11-14; the
// Terms (Part E) must state the same rules.
const html = (el: JSX.Element) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

describe('refund policy and contact pages', () => {
  it('both name the seller, GSTIN and support email, and link the other policies', () => {
    for (const page of [<RefundPolicyView key="r" />, <ContactView key="c" />]) {
      const h = html(page);
      expect(h).toContain('Sirah Digital');
      expect(h).toContain('33CVVPM9805M1ZO');
      expect(h).toContain('support@sirahdigital.in');
      for (const href of ['/terms', '/privacy']) expect(h).toContain(`href="${href}"`);
    }
    expect(html(<ContactView />)).toContain('Zamin Pallavaram');
    expect(html(<ContactView />)).toContain('href="/refund-policy"');
  });

  it('the refund rules are the approved ones', () => {
    const h = html(<RefundPolicyView />);
    expect(h).toMatch(/Sanad and Vakalat<\/strong> \(monthly or yearly\): not refundable/);
    expect(h).toContain('within 7 days of the payment and have used no more than 10 AI credits');
    expect(h).toContain('Once any of its credits are used, a Brief Pack is not refundable.');
    expect(h).toContain('nothing renews or is charged automatically');
    expect(h).not.toMatch(/renew automatically|Autopay|mandate/i);
  });

  it('the Terms (Part E) say the same, with no older conflicting rule left', () => {
    const t = html(<TermsView />);
    expect(t).toContain('no more than 10 AI credits were used');
    expect(t).toContain('Sanad and Vakalat');
    expect(t).not.toContain('a quarter of that period');
    expect(t).not.toContain('within 48 hours of the renewal charge');
    expect(t).toContain('href="/refund-policy"');
    expect(t).toContain('Nothing renews or is charged automatically');
    expect(t).not.toContain('renew automatically');
  });

  it('the pages are public, served by nginx, and linked from the landing footer', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    for (const p of ['/refund-policy', '/contact']) {
      expect(app).toContain(`location.pathname === '${p}'`);
      expect(app).toContain(`<Route path="${p}"`);
    }
    expect(fs.readFileSync(path.resolve(__dirname, '../../../nginx.conf'), 'utf8')).toContain('refund-policy|contact');
    const landing = fs.readFileSync(path.resolve(__dirname, '../LandingView.tsx'), 'utf8');
    expect(landing).not.toMatch(/lexdraft\.in|wa\.me\/918045678900/);
    for (const p of ["'/refund-policy'", "'/contact'"]) expect(landing).toContain(p);
  });
});
