-- =============================================================================
-- LexDraft - clause bank
-- =============================================================================
-- Firm-scoped clause library. Categories are free-text (no separate table).
-- The 14 starter clauses that previously lived hardcoded in ClausesView are
-- seeded under the bootstrap firm so the UI stays populated post-migration.
-- =============================================================================

create table if not exists clauses (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms(id) on delete cascade,
  category    text not null,
  title       text not null,
  description text not null default '',
  body        text not null default '',
  uses        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists clauses_firm_idx     on clauses (firm_id);
create index if not exists clauses_category_idx on clauses (firm_id, category);

do $$ begin
  create trigger trg_clauses_updated before update on clauses for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- Seed the 14 starter clauses for the bootstrap firm. on conflict guard so
-- repeated migrations don't double-insert.
insert into clauses (id, firm_id, category, title, description, body, uses) values
  ('22222222-2222-2222-2222-000000000001', '00000000-0000-0000-0000-000000000001', 'Indemnity',                'Mutual Indemnity (Standard)',         'Reciprocal indemnification covering third-party claims arising from a party breach, capped at fees paid in the prior 12 months.', 'Each Party shall indemnify, defend and hold harmless the other Party…', 184),
  ('22222222-2222-2222-2222-000000000002', '00000000-0000-0000-0000-000000000001', 'Indemnity',                'IP Infringement Indemnity',           'Service-provider indemnifies customer against claims that the deliverables infringe Indian or foreign IP rights.',                  'The Service Provider shall indemnify the Customer against any third-party claim…', 121),
  ('22222222-2222-2222-2222-000000000003', '00000000-0000-0000-0000-000000000001', 'Indemnity',                'Data Breach Indemnity',               'Uncapped indemnity for losses arising from breach of personal data or violation of the DPDP Act, 2023.',                            'Notwithstanding any limitation of liability, the Processor shall indemnify…', 96),
  ('22222222-2222-2222-2222-000000000004', '00000000-0000-0000-0000-000000000001', 'Indemnity',                'Tax Indemnity (Withholding)',         'Cross-border services template; payer indemnified for any short-deduction of TDS or grossing-up obligations.',                       'If any deduction or withholding is required by law, the paying Party shall…', 58),
  ('22222222-2222-2222-2222-000000000005', '00000000-0000-0000-0000-000000000001', 'Indemnity',                'Employment Misclassification Indemnity', 'Contractor indemnifies principal against PF/ESI/gratuity claims by deployed personnel.',                                          'The Contractor confirms that all deployed personnel are its employees…', 33),
  ('22222222-2222-2222-2222-000000000006', '00000000-0000-0000-0000-000000000001', 'Limitation of Liability', 'Aggregate Cap - 12 Months Fees',      'Standard SaaS cap: aggregate liability limited to fees paid by the customer in the 12 months preceding the claim.',                  'The aggregate liability of either Party shall not exceed the fees paid…', 241),
  ('22222222-2222-2222-2222-000000000007', '00000000-0000-0000-0000-000000000001', 'Limitation of Liability', 'Exclusion of Indirect Damages',       'Carves out indirect, consequential, punitive, loss of profit and loss of data damages from recoverable losses.',                     'In no event shall either Party be liable for any indirect, consequential…', 218),
  ('22222222-2222-2222-2222-000000000008', '00000000-0000-0000-0000-000000000001', 'Limitation of Liability', 'Carve-outs for Wilful Misconduct',    'Cap and exclusions do not apply to gross negligence, wilful misconduct, fraud, or breach of confidentiality.',                       'The limitations set out in this Clause shall not apply to liability…', 167),
  ('22222222-2222-2222-2222-000000000009', '00000000-0000-0000-0000-000000000001', 'Limitation of Liability', 'Super Cap for Data Incidents',        'Two-tier cap: standard 1× annual fees, with a 3× super-cap reserved for data protection breaches.',                                  'For breaches of Clause [Data Protection], the aggregate liability shall not exceed three times…', 74),
  ('22222222-2222-2222-2222-000000000010', '00000000-0000-0000-0000-000000000001', 'Termination',             'Termination for Convenience (90 days)','Either party may terminate without cause on 90 days written notice; pro-rated refund of pre-paid fees.',                              'Either Party may terminate this Agreement for convenience by giving ninety (90) days…', 152),
  ('22222222-2222-2222-2222-000000000011', '00000000-0000-0000-0000-000000000001', 'Termination',             'Termination for Material Breach',     'Cure period of 30 days following written notice; immediate termination for non-curable breaches.',                                   'A Party may terminate this Agreement immediately upon written notice if the other Party commits a material breach…', 198),
  ('22222222-2222-2222-2222-000000000012', '00000000-0000-0000-0000-000000000001', 'Termination',             'Insolvency Termination',              'Termination triggers on initiation of CIRP under IBC, voluntary winding up, or appointment of a resolution professional.',           'This Agreement shall terminate automatically upon the commencement of any insolvency resolution process under the IBC, 2016…', 88),
  ('22222222-2222-2222-2222-000000000013', '00000000-0000-0000-0000-000000000001', 'Termination',             'Effects of Termination',              'Survival of confidentiality, indemnity and limitation clauses; data return and certificate of destruction.',                         'Upon termination, each Party shall return or destroy all Confidential Information…', 145)
  on conflict (id) do nothing;
