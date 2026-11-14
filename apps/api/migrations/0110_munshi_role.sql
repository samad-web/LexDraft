-- Munshi: the advocate's clerk (features/pricing-v4.md, owner 2026-11-14).
-- Keeps the diary and cause list, tracks hearings and next dates, files papers
-- (eFiling) and pays court fees, keeps the case files. No drafting and no AI.
-- A Munshi seat (firms.munshi_seats) covers users with this role. Additive.

insert into roles (id, firm_id, name, description, is_system)
select gen_random_uuid(), null, 'Munshi',
       'Advocate''s clerk: diary, cause list, hearings, eCourts, eFiling, documents. No AI.', true
where not exists (select 1 from roles where firm_id is null and name = 'Munshi');

-- Plan AND role must both grant a feature, so these only open what the firm's
-- plan already has. drafting.basic is needed for uploading documents; the AI
-- features (drafting.ai, mock arguments, research, matter intelligence) are
-- not granted, and matter intelligence (a baseline feature) is removed for
-- Munshi in permissions.service.
insert into role_features (role_id, feature_key, enabled)
select r.id, f.key, true
from roles r join features f on f.key in (
  'matter.view', 'matter.create', 'client.view', 'drafting.basic',
  'tools.calculators', 'firm.members.view'
)
where r.firm_id is null and r.name = 'Munshi'
on conflict do nothing;
