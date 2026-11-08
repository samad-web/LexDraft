import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- fakes: a tagged-template db, the notification store, recipients, jobs ----
const limitationRows: unknown[] = [];
const taskRows: unknown[] = [];
const created: Array<{ userId: string; dedupeKey?: string; tone?: string; view?: string }> = [];
const emails: Array<{ to: string; subject: string }> = [];

vi.mock('../../db/client', () => ({
  db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join('?');
    if (q.includes('from limitations')) return Promise.resolve(limitationRows);
    if (q.includes('from tasks')) return Promise.resolve(taskRows);
    if (q.includes('from notifications')) {
      const [userId, key] = values;
      return Promise.resolve(created.some((c) => c.userId === userId && c.dedupeKey === key) ? [{ one: 1 }] : []);
    }
    throw new Error(`unexpected query: ${q}`);
  },
}));
vi.mock('../notifications.service', () => ({
  notificationsStore: {
    create: async (input: { userId: string; dedupeKey?: string; tone?: string; view?: string }) => {
      created.push(input);
      return `n${created.length}`;
    },
  },
  resolveCaseRecipients: async (_firmId: string, owner: string | null) =>
    owner ? [{ id: owner, email: `${owner}@x.in` }] : [{ id: 'admin', email: 'admin@x.in' }],
}));
vi.mock('../jobs.service', () => ({
  jobs: { enqueue: async (_name: string, args: { to: string; subject: string }) => { emails.push(args); } },
}));

import {
  istToday, limitationAlert, runDeadlineAlerts, taskAlert, TASK_ALERT_DAYS,
  type LimitationDue, type TaskDue,
} from '../deadline-alerts.service';

const lim = (days: number, extra: Partial<LimitationDue> = {}): LimitationDue => ({
  id: 'L1', firm_id: 'F1', owner_user_id: null, case_label: 'Ravi v. Kumar',
  filing_type: 'Suit for money lent', forum: 'City Civil Court', deadline: '2026-12-01', days_left: days, ...extra,
});
const task = (priority: string, days: number, extra: Partial<TaskDue> = {}): TaskDue => ({
  id: 'T1', firm_id: 'F1', owner_user_id: 'U1', case_label: 'ABD vs SAMA',
  title: 'File vakalat', priority, due_date: '2026-11-10', days_left: days, ...extra,
});

beforeEach(() => {
  limitationRows.length = 0;
  taskRows.length = 0;
  created.length = 0;
  emails.length = 0;
});

describe('limitation alerts', () => {
  it('fire only at 90, 30, 7, 1 and 0 days', () => {
    const firing = Array.from({ length: 100 }, (_, i) => 99 - i).filter((d) => limitationAlert(lim(d)) !== null);
    expect(firing).toEqual([90, 30, 7, 1, 0]);
    expect(limitationAlert(lim(-1))).toBeNull(); // no daily overdue spam
  });

  it('are red and emailed from 7 days; earlier ones are bell-only', () => {
    expect(limitationAlert(lim(7))).toMatchObject({ tone: 'vermillion', email: true });
    expect(limitationAlert(lim(30))).toMatchObject({ tone: 'cobalt', email: false });
    expect(limitationAlert(lim(0))?.title).toBe('Limitation expires today: Ravi v. Kumar');
    expect(limitationAlert(lim(1))?.body).toContain('Last day: 1 Dec 2026');
  });
});

describe('task alerts scale with priority', () => {
  it.each(Object.entries(TASK_ALERT_DAYS))('%s fires on exactly its days', (priority, days) => {
    const firing = [5, 4, 3, 2, 1, 0, -1, -2].filter((d) => taskAlert(task(priority, d)) !== null);
    expect(firing).toEqual(days);
  });

  it('marks overdue red, due today amber, and emails only high and very high', () => {
    expect(taskAlert(task('high', -1))).toMatchObject({ tone: 'vermillion', title: 'Task overdue: File vakalat', email: true });
    expect(taskAlert(task('medium', 0))).toMatchObject({ tone: 'amber', title: 'Task due today: File vakalat', email: false });
    expect(taskAlert(task('very_high', 3))).toMatchObject({ tone: 'cobalt', email: true });
    expect(taskAlert(task('mystery', 0))).toBeNull();
  });
});

describe('istToday', () => {
  it('uses the Indian date, not the server date', () => {
    expect(istToday(new Date('2026-11-08T19:00:00Z'))).toBe('2026-11-09'); // 00:30 IST
    expect(istToday(new Date('2026-11-08T18:00:00Z'))).toBe('2026-11-08'); // 23:30 IST
  });
});

describe('runDeadlineAlerts', () => {
  it('notifies the matter owner, else the firm admins, and emails only urgent ones', async () => {
    limitationRows.push(lim(7), lim(30, { id: 'L2' }));
    taskRows.push(task('low', 0), task('high', 1, { id: 'T2' }), task('low', 1, { id: 'T3' }));
    expect(await runDeadlineAlerts()).toBe(4); // T3 (low, 1 day) is not an alert day
    expect(created.map((c) => `${c.userId} ${c.dedupeKey}`)).toEqual([
      'admin limitation:L1:7', 'admin limitation:L2:30', 'U1 task:T1:0', 'U1 task:T2:1',
    ]);
    expect(emails.map((e) => e.to)).toEqual(['admin@x.in', 'U1@x.in']); // L1 (7 days) and T2 (high)
  });

  it('running twice the same day sends nothing new', async () => {
    limitationRows.push(lim(1));
    taskRows.push(task('very_high', 0));
    expect(await runDeadlineAlerts()).toBe(2);
    expect(await runDeadlineAlerts()).toBe(0);
    expect(created).toHaveLength(2);
    expect(emails).toHaveLength(2);
  });
});
