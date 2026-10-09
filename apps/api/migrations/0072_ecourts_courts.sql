-- =============================================================================
-- LexDraft - individual court names within each cached court complex
-- =============================================================================
-- A "Court complex" (ecourts_court_complexes) is a building; a case is
-- actually filed at a specific COURT inside it (e.g. "Munsiff Court,
-- Chengannur" is one of six courts inside "Court Complex, Chengannur").
-- Search endpoints need the individual court's code (est_code), not the
-- complex code - selecting only the complex isn't enough to find a real case
-- (verified live: a case existed under court_code 17 "Munsiff Court,
-- Chengannur" while codes 16/26/43/44 in the same complex returned nothing
-- for the same search).
--
-- Names captured live by probing each court_code in a complex against a
-- real (zero-match) search and reading the `establishment_name` the eCourts
-- backend echoes back - the establishment-directory endpoint itself is
-- blocked for automated callers, but individual court names surface for
-- free as a side effect of any search response.
-- =============================================================================

create table if not exists ecourts_courts (
  id            uuid primary key default gen_random_uuid(),
  court         text not null default 'DC',
  state_code    integer not null,
  dist_code     integer not null,
  complex_code  text not null,        -- FK-ish to ecourts_court_complexes.complex_code
  court_code    text not null,        -- the code searches need as `estCode`
  court_name    text not null,        -- e.g. 'Munsiff Court, Chengannur'
  captured_at   timestamptz not null default now(),
  unique (court, state_code, dist_code, court_code)
);

create index if not exists ecourts_courts_lookup_idx
  on ecourts_courts (court, state_code, dist_code, complex_code);

-- Seed: Kerala (4) / Alappuzha (6) / Court Complex, Chengannur (1040071),
-- captured live 2026-09-30 against the real eCourts backend.
insert into ecourts_courts (court, state_code, dist_code, complex_code, court_code, court_name) values
  ('DC', 4, 6, '1040071', '16', 'Sub Court, Chengannur'),
  ('DC', 4, 6, '1040071', '17', 'Munsiff Court, Chengannur'),
  ('DC', 4, 6, '1040071', '18', 'JFCM I, Chengannur'),
  ('DC', 4, 6, '1040071', '26', 'JFCM II, Chengannur'),
  ('DC', 4, 6, '1040071', '43', 'Commercial Court, Chengannur'),
  ('DC', 4, 6, '1040071', '44', 'Fast Track Special Court, Chengannur')
on conflict (court, state_code, dist_code, court_code) do nothing;
