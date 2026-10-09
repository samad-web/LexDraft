-- =============================================================================
-- LexDraft - cached eCourts court-complex directory
-- =============================================================================
-- eCourts' live establishment-directory endpoint (courtEstWebService.php) is
-- blocked for server-side/automated callers, and the website's equivalent
-- AJAX call (casestatus/fillcomplex) is only reachable from a real browser
-- session and gets rate-limited/blocked under repeated automated use.
--
-- So the "Court complex" picker in the eCourts search forms can't be a live
-- dropdown backed by a per-request API call. Instead we cache the directory
-- here: captured ONCE per district via a single real-browser session (not a
-- repeated automated search - the thing that gets blocked), then served
-- instantly from our own database from then on. This is the same list the
-- eCourts website itself shows in its "Select Court Complex" dropdown.
--
-- `court_codes` holds the individual court/bench codes within the complex
-- (the eCourts UI value format is `<complex_code>@<court_code,court_code,...>@<flag>`)
-- - most searches only need the complex-level code, but some endpoints want a
-- specific court within it.
-- =============================================================================

create table if not exists ecourts_court_complexes (
  id            uuid primary key default gen_random_uuid(),
  court         text not null default 'DC',      -- 'DC' | 'HC'
  state_code    integer not null,
  dist_code     integer not null,
  complex_code  text not null,                    -- e.g. '1040061'
  complex_name  text not null,                     -- e.g. 'Court Complex, CHERTHALA'
  court_codes   text[] not null default '{}',      -- e.g. {12,13,14,15,30,31,42,45,46}
  captured_at   timestamptz not null default now(),
  unique (court, state_code, dist_code, complex_code)
);

create index if not exists ecourts_court_complexes_lookup_idx
  on ecourts_court_complexes (court, state_code, dist_code);

-- Seed: Kerala (state_code 4) / Alappuzha (dist_code 6), captured live via a
-- single real-browser session against services.ecourts.gov.in on 2026-09-30.
insert into ecourts_court_complexes (court, state_code, dist_code, complex_code, complex_name, court_codes) values
  ('DC', 4, 6, '1040058', 'COURT COMPLEX,RAMANKARI',        '{19}'),
  ('DC', 4, 6, '1040059', 'Family Court, Alappuzha',        '{35}'),
  ('DC', 4, 6, '1040060', 'Court Complex, Kayamkulam',      '{7,8,27}'),
  ('DC', 4, 6, '1040061', 'Court Complex, CHERTHALA',       '{12,13,14,15,30,31,42,45,46}'),
  ('DC', 4, 6, '1040062', 'Court Complex, MAVELIKARA',      '{21,22,23,24,25,33,34,41}'),
  ('DC', 4, 6, '1040063', 'Gram Nyayalaya, Ambalappuzha',   '{37}'),
  ('DC', 4, 6, '1040065', 'Family Court, Mavelikkara',      '{36}'),
  ('DC', 4, 6, '1040066', 'DISTRICT COURT, Alappuzha',      '{1,2,3,4,5,6,20,29,32,40,47}'),
  ('DC', 4, 6, '1040068', 'Court Complex, Haripad',         '{9,10,28,39}'),
  ('DC', 4, 6, '1040069', 'JFCM, Ambalappuzha',             '{11}'),
  ('DC', 4, 6, '1040070', 'Gram Nyayalaya, Kanjikuzhi',     '{38}'),
  ('DC', 4, 6, '1040071', 'Court Complex, Chengannur',      '{16,17,18,26,43,44}')
on conflict (court, state_code, dist_code, complex_code) do nothing;
