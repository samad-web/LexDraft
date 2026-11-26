-- team-docs (build-docs/features/team-docs.md). Additive.
-- Who made each document, and the document / draft a copy came from, so copies
-- (marked, edited, duplicated) sit under their original with the maker's name.
alter table documents add column if not exists created_by uuid references users(id) on delete set null;
alter table documents add column if not exists parent_document_id uuid references documents(id) on delete set null;
alter table documents add column if not exists parent_draft_id uuid references drafts(id) on delete set null;
create index if not exists documents_parent_document_idx on documents (parent_document_id);

-- Tasks sent to teammates from a review ("Send to teammate"); closed when every
-- margin note is ticked Done.
alter table document_reviews add column if not exists task_ids uuid[] not null default '{}';

-- Fill in what the app already knows (only rows where nothing is set yet).
update documents d
   set created_by = r.user_id,
       parent_document_id = coalesce(d.parent_document_id, r.source_document_id),
       parent_draft_id = coalesce(d.parent_draft_id, r.draft_id)
  from document_reviews r
 where r.result_document_id = d.id and d.created_by is null and r.source_document_id is distinct from d.id;

update documents d
   set created_by = dr.user_id,
       parent_document_id = coalesce(d.parent_document_id, dr.source_document_id)
  from drafts dr
 where dr.edited_document_id = d.id and d.created_by is null and dr.source_document_id is distinct from d.id;

update documents d
   set created_by = dr.user_id
  from drafts dr
 where dr.source_document_id = d.id and d.created_by is null;
