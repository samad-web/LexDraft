# Team work: assign work like Teams (owner 2026-11-18)

## Purpose
Make team management look professional and assigning work easy: see each member's load, give them a task or a case in two clicks, and let everyone filter the board to their own work. Joining already works like Teams (team-join.md).

## Architecture
- DB 0118 (additive): `tasks.assignee_user_id`, `tasks.created_by_user_id` (nullable FKs, set null on user delete) + index. `tasks.assignee` text stays (initials on cards; old rows).
- `services/team-work.service.ts`: `requireMember` (active, same firm, not superadmin), `notifyAssigned` (bell, view `tasks?mine=1` / `cases`; WhatsApp only when `WHATSAPP_ASSIGN_TEMPLATE` is set and the member has a verified number), `teamWorkload`, `notifyCaseLead`, `actorFor`.
- API: `POST/PATCH /tasks` accept `assigneeUserId`; server sets initials, `created_by_user_id`, notifies on new assignee only. `PUT /cases/:id/lead` now notifies the new lead. `GET /firm/team` (firm.members.view) = per-member lead cases, hearings next 7 days, open/overdue tasks.
- Task reminders (deadline-alerts) go to the assignee first, else the matter owner.
- Web: member cards show workload + Assign task / Assign case / View tasks (heads only); NewTaskModal "Assign to" member picker (was typed initials); Tasks board filters All / Assigned to me / Assigned by me / By person (URL ?mine=1, ?by=me, ?assignee=id).

## Impact map
- tasks table, tasks routes/service, cases lead route, firm routes, deadline-alerts, notifications; MembersView, NewTaskModal (also used from case pages), TasksView, useTasks, firm.css.
- Who may assign a case is unchanged (assignments.service head-role rule). Any member with matter.create may create tasks (unchanged).

## Edge cases
- Member outside the firm / deactivated → 400 not_a_member, nothing saved.
- Assigning to yourself → no bell. Same assignee again → no second bell.
- WhatsApp template not approved yet → bell only (owner must create `difai_work_assigned` in Wasi with params member_name, assigned_by, work, due_date, app_link, then set the env).
- Old tasks (no user id) still show; they appear only under "All tasks".

## Acceptance criteria
- AC1 task saved for member + by whom; member bell. AC2 outsider refused. AC3 re-assign tells new member only. AC4 WhatsApp only with template + verified phone. AC5 new case lead bell. AC6 workload counts. AC7 member card workload + Assign task/case. AC8 board filters.
