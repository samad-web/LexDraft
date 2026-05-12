import type { Task, TaskBoard, TaskColumn } from '@lexdraft/types';
import { db } from '../db/client';
import { SEED_TASKS } from '../data/seed';

interface TaskRow {
  id: string;
  case_label: string;
  title: string;
  due_date: string | Date | null;
  priority: Task['priority'];
  assignee: string;
  comments_count: number;
  column_name: TaskColumn;
}

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
      const rows = await sql<TaskRow[]>`
        select id, case_label, title, due_date, priority, assignee, comments_count, column_name
        from tasks
        where firm_id = ${firmId}::uuid
        order by created_at
      `;
      const board = emptyBoard();
      for (const row of rows) board[row.column_name].push(fromRow(row));
      return board;
    }
    return memory;
  },

  async move(taskId: string, to: TaskColumn, firmId: string | null): Promise<TaskBoard> {
    if (!firmId) return emptyBoard();
    const sql = db();
    if (sql) {
      await sql`
        update tasks set column_name = ${to}::task_column
        where id::text = ${taskId} and firm_id = ${firmId}::uuid
      `;
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
    if (task) {
      task.column = to;
      memory[to].push(task);
    }
    return memory;
  },

  async create(input: Omit<Task, 'id'>, firmId: string | null): Promise<Task> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached — cannot create task'), { status: 422 });
    }
    const sql = db();
    if (sql) {
      const rows = await sql<TaskRow[]>`
        insert into tasks (firm_id, case_label, title, due_date, priority, assignee, comments_count, column_name)
        values (${firmId}::uuid, ${input.case}, ${input.title}, ${input.due || null},
                ${input.priority}::task_priority, ${input.assignee},
                ${input.comments}, ${input.column}::task_column)
        returning id, case_label, title, due_date, priority, assignee, comments_count, column_name
      `;
      return fromRow(rows[0]!);
    }
    const allIds = Object.values(memory).flat().map((t) => Number(t.id.replace(/\D/g, ''))).filter(Number.isFinite);
    const next = (allIds.length ? Math.max(...allIds) : 0) + 1;
    const task: Task = { ...input, id: `t${next}` };
    memory[task.column].push(task);
    return task;
  },

  async update(taskId: string, patch: Partial<Task>, firmId: string | null): Promise<Task | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (sql) {
      const rows = await sql<TaskRow[]>`
        update tasks set
          title          = coalesce(${patch.title ?? null}, title),
          case_label     = coalesce(${patch.case ?? null}, case_label),
          due_date       = coalesce(${patch.due ?? null}, due_date),
          priority       = coalesce(${patch.priority ?? null}::task_priority, priority),
          assignee       = coalesce(${patch.assignee ?? null}, assignee),
          comments_count = coalesce(${patch.comments ?? null}, comments_count),
          column_name    = coalesce(${patch.column ?? null}::task_column, column_name)
        where id::text = ${taskId} and firm_id = ${firmId}::uuid
        returning id, case_label, title, due_date, priority, assignee, comments_count, column_name
      `;
      const row = rows[0];
      return row ? fromRow(row) : undefined;
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
