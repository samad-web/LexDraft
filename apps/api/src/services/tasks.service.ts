import type { Task, TaskBoard, TaskColumn } from '@lexdraft/types';
import { db } from '../db/client';
import { SEED_TASKS } from '../data/seed';
import { initialsOf, notifyAssigned, requireMember } from './team-work.service';

interface TaskRow {
  id: string;
  case_label: string;
  title: string;
  due_date: string | Date | null;
  priority: Task['priority'];
  assignee: string;
  comments_count: number;
  column_name: TaskColumn;
  case_id?: string | null;
  assignee_user_id?: string | null;
  assignee_name?: string | null;
  created_by_user_id?: string | null;
}

/** Who acts on a task (route's signed-in user). */
export interface TaskActor { id: string; name: string }


let memory: TaskBoard = JSON.parse(JSON.stringify(SEED_TASKS));

function fromRow(r: TaskRow): Task {
  const due =
    r.due_date instanceof Date
      ? r.due_date.toISOString().slice(0, 10)
      : (r.due_date ?? '');
  return {
    id: r.id,
    case: r.case_label,
    title: r.title,
    due,
    priority: r.priority,
    assignee: r.assignee,
    comments: r.comments_count,
    column: r.column_name,
    caseId: r.case_id ?? null,
    assigneeUserId: r.assignee_user_id ?? null,
    assigneeName: r.assignee_name ?? null,
    createdByUserId: r.created_by_user_id ?? null,
  };
}

function emptyBoard(): TaskBoard {
  return { pending: [], progress: [], review: [], done: [] };
}

export const tasksService = {
  async board(firmId: string | null): Promise<TaskBoard> {
    if (!firmId) return emptyBoard();
    const sql = db();
    if (sql) {
      // case_id (migration 0089) is read via to_jsonb so this keeps working on
      // a database where that migration hasn't been applied yet.
      const rows = await sql<TaskRow[]>`
        select t.id, t.case_label, t.title, t.due_date, t.priority, t.assignee,
               t.comments_count, t.column_name, to_jsonb(t) ->> 'case_id' as case_id,
               to_jsonb(t) ->> 'assignee_user_id' as assignee_user_id,
               to_jsonb(t) ->> 'created_by_user_id' as created_by_user_id,
               au.name as assignee_name
        from tasks t
        left join users au on au.id::text = to_jsonb(t) ->> 'assignee_user_id'
        where t.firm_id = ${firmId}::uuid
        order by t.created_at
      `;
      const board = emptyBoard();
      for (const row of rows) board[row.column_name].push(fromRow(row));
      return board;
    }
    return memory;
  },

  async move(taskId: string, to: TaskColumn, firmId: string | null): Promise<TaskBoard | undefined> {
    if (!firmId) return emptyBoard();
    const sql = db();
    if (sql) {
      const rows = await sql`
        update tasks set column_name = ${to}::task_column
        where id::text = ${taskId} and firm_id = ${firmId}::uuid
        returning id
      `;
      if (rows.length === 0) return undefined;
      return tasksService.board(firmId);
    }
    const cols: TaskColumn[] = ['pending', 'progress', 'review', 'done'];
    let task: Task | undefined;
    for (const k of cols) {
      const i = memory[k].findIndex((t) => t.id === taskId);
      if (i >= 0) {
        task = memory[k][i]!;
        memory[k].splice(i, 1);
        break;
      }
    }
    if (!task) return undefined;
    task.column = to;
    memory[to].push(task);
    return memory;
  },

  async create(input: Omit<Task, 'id'>, firmId: string | null, actor?: TaskActor): Promise<Task> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot create task'), { status: 422 });
    }
    const sql = db();
    if (sql) {
      // team-work: a member picked from the team; the board avatar shows their initials.
      const member = input.assigneeUserId ? await requireMember(firmId, input.assigneeUserId) : null;
      const rows = await sql<TaskRow[]>`
        insert into tasks (firm_id, case_label, title, due_date, priority, assignee, comments_count, column_name,
                           assignee_user_id, created_by_user_id)
        values (${firmId}::uuid, ${input.case}, ${input.title}, ${input.due || null},
                ${input.priority}::task_priority, ${member ? initialsOf(member.name) : input.assignee},
                ${input.comments}, ${input.column}::task_column,
                ${member?.id ?? null}::uuid, ${actor?.id ?? null}::uuid)
        returning id, case_label, title, due_date, priority, assignee, comments_count, column_name,
                  assignee_user_id, created_by_user_id
      `;
      const task = fromRow({ ...rows[0]!, assignee_name: member?.name ?? null });
      if (member && actor) {
        await notifyAssigned({ firmId, actorId: actor.id, actorName: actor.name, member, kind: 'task', title: task.title, due: task.due, dedupeKey: `task-assigned:${task.id}:${member.id}` });
      }
      return task;
    }
    const allIds = Object.values(memory).flat().map((t) => Number(t.id.replace(/\D/g, ''))).filter(Number.isFinite);
    const next = (allIds.length ? Math.max(...allIds) : 0) + 1;
    const task: Task = { ...input, id: `t${next}` };
    memory[task.column].push(task);
    return task;
  },

  async update(taskId: string, patch: Partial<Task>, firmId: string | null, actor?: TaskActor): Promise<Task | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (sql) {
      const member = patch.assigneeUserId ? await requireMember(firmId, patch.assigneeUserId) : null;
      const [before] = member
        ? await sql<Array<{ a: string | null }>>`select to_jsonb(t) ->> 'assignee_user_id' as a from tasks t where id::text = ${taskId} and firm_id = ${firmId}::uuid`
        : [];
      if (member) patch = { ...patch, assignee: initialsOf(member.name) };
      const rows = await sql<TaskRow[]>`
        update tasks set
          assignee_user_id = coalesce(${member?.id ?? null}::uuid, assignee_user_id),
          title          = coalesce(${patch.title ?? null}, title),
          case_label     = coalesce(${patch.case ?? null}, case_label),
          due_date       = coalesce(${patch.due ?? null}, due_date),
          priority       = coalesce(${patch.priority ?? null}::task_priority, priority),
          assignee       = coalesce(${patch.assignee ?? null}, assignee),
          comments_count = coalesce(${patch.comments ?? null}, comments_count),
          column_name    = coalesce(${patch.column ?? null}::task_column, column_name)
        where id::text = ${taskId} and firm_id = ${firmId}::uuid
        returning id, case_label, title, due_date, priority, assignee, comments_count, column_name,
                  assignee_user_id, created_by_user_id
      `;
      const row = rows[0];
      if (!row) return undefined;
      const task = fromRow({ ...row, assignee_name: member?.name ?? null });
      // Re-assigned to someone new: tell them.
      if (member && actor && before?.a !== member.id) {
        await notifyAssigned({ firmId, actorId: actor.id, actorName: actor.name, member, kind: 'task', title: task.title, due: task.due, dedupeKey: `task-assigned:${task.id}:${member.id}` });
      }
      return task;
    }
    for (const k of Object.keys(memory) as TaskColumn[]) {
      const i = memory[k].findIndex((t) => t.id === taskId);
      if (i >= 0) {
        memory[k][i] = { ...memory[k][i]!, ...patch, id: taskId };
        return memory[k][i];
      }
    }
    return undefined;
  },

  async remove(taskId: string, firmId: string | null): Promise<boolean> {
    if (!firmId) return false;
    const sql = db();
    if (sql) {
      const rows = await sql`
        delete from tasks where id::text = ${taskId} and firm_id = ${firmId}::uuid returning id
      `;
      return rows.length > 0;
    }
    for (const k of Object.keys(memory) as TaskColumn[]) {
      const i = memory[k].findIndex((t) => t.id === taskId);
      if (i >= 0) {
        memory[k].splice(i, 1);
        return true;
      }
    }
    return false;
  },

  reset(): void {
    memory = JSON.parse(JSON.stringify(SEED_TASKS));
  },
};
