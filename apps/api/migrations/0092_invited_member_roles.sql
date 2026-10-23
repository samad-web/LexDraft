-- =============================================================================
-- 0092_invited_member_roles.sql
-- =============================================================================
-- Members who joined through an invitation as Senior Associate, Associate,
-- Junior Associate, Of Counsel or Paralegal were created with role_id = null
-- (auth.service only mapped Managing Partner), so the permission resolver gave
-- them baseline-only access. The mapping is fixed in code; this backfills the
-- users already affected.
--
-- Only fills role_id where it is NULL - never overwrites a role an admin set.
-- Safe to re-run.
-- =============================================================================

update users u
set role_id = r.id
from roles r
where u.role_id is null
  and r.firm_id is null
  and r.is_system = true
  and r.name = case u.role
    when 'Senior Associate' then 'Senior Associate'
    when 'Associate'        then 'Associate'
    when 'Junior Associate' then 'Associate'
    when 'Of Counsel'       then 'Senior Associate'
    when 'Paralegal'        then 'Paralegal'
  end;
