-- =============================================================================
-- LexDraft - remove sample/seed content
-- =============================================================================
-- Wipes the cases, hearings, alerts, documents, and tasks that were inserted
-- by 0002_seed.sql so the live DB reflects a true empty starting state.
-- The default firm row (00000000-0000-0000-0000-000000000001) is intentionally
-- preserved because auth.service.ts references it as SEED_FIRM_ID when
-- provisioning new users.
--
-- Targets the seed rows by their distinct identifying values, so any rows the
-- user has created since are left untouched.
-- =============================================================================

-- ---- cases (matched by CNR) -------------------------------------------------
delete from cases where cnr in (
  'DLHC010012345-2024',
  'MHHC020087612-2024',
  'KAHC030045871-2025',
  'TNHC040112233-2025',
  'DLDC010998877-2024'
);

-- ---- hearings (matched by case_label + time + court) ------------------------
delete from hearings where (case_label, hearing_time, court) in (
  ('Mehta v. Verma',   '10:30', 'DHC, CR-12'),
  ('Rao v. HDFC Bank', '11:45', 'Saket DC, R-204'),
  ('State v. Khanna',  '14:15', 'BHC, CR-3')
);

-- ---- alerts (matched by exact text + detail) --------------------------------
delete from alerts where (text, detail) in (
  ('Limitation expires in 4 days',     'Patel v. Reliance - Section 138 NI Act'),
  ('Cross-examination prep pending',   'Mehta v. Verma - tomorrow 10:30'),
  ('eCourts status update',            'Rao v. HDFC - order uploaded')
);

-- ---- documents (matched by name) --------------------------------------------
delete from documents where name in (
  'Plaint - Patel v. Reliance Infra.docx',
  'Written Statement - Coastal Estates.docx',
  'Affidavit - Mehta cross-prep.docx',
  'Bail Application - Khanna.docx'
);

-- ---- tasks (matched by title) -----------------------------------------------
delete from tasks where title in (
  'Draft rejoinder to WS',
  'File vakalatnama at Saket',
  'Compile evidence affidavit annexures',
  'Stamp duty calculation for property',
  'Plaint draft v3',
  'Court fee deposit receipt'
);
