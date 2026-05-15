import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Task, TaskBoard, TaskColumn } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useTaskBoard() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.get<TaskBoard>('/tasks'),
  });
}

export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to }: { id: string; to: TaskColumn }) =>
      api.post<TaskBoard>(`/tasks/${id}/move`, { to }),
    onMutate: async ({ id, to }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueryData<TaskBoard>(['tasks']);
      if (prev) {
        const next: TaskBoard = {
          pending: [...prev.pending],
          progress: [...prev.progress],
          review: [...prev.review],
          done: [...prev.done],
        };
        for (const k of Object.keys(next) as TaskColumn[]) {
          const i = next[k].findIndex((t) => t.id === id);
          if (i >= 0) {
            const [task] = next[k].splice(i, 1);
            if (task) {
              task.column = to;
              next[to].push(task);
            }
            break;
          }
        }
        qc.setQueryData(['tasks'], next);
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Task, 'id'>) => api.post<Task>('/tasks', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/tasks/${id}`),
    // Optimistic remove from whichever column the task currently lives in.
    // Mirrors the useMoveTask pattern so the drag-and-delete experience
    // feels equally snappy - the rollback path restores the snapshot if
    // the server rejects the delete.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueryData<TaskBoard>(['tasks']);
      if (prev) {
        const next: TaskBoard = {
          pending: prev.pending.filter((t) => t.id !== id),
          progress: prev.progress.filter((t) => t.id !== id),
          review: prev.review.filter((t) => t.id !== id),
          done: prev.done.filter((t) => t.id !== id),
        };
        qc.setQueryData(['tasks'], next);
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
