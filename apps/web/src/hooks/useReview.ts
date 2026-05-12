import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Contract-review hooks. Types are kept local to the web app for now (mirror
 * of `apps/api/src/types/review.types.ts`); the orchestrator will hoist them
 * into `@lexdraft/types` once the feature graduates from preview.
 */

export type ReviewPerspective =
  | 'Client'
  | 'Vendor'
  | 'Employer'
  | 'Employee'
  | 'Landlord'
  | 'Tenant'
  | 'Company';

export type ReviewSeverity =
  | 'Critical'
  | 'High'
  | 'Moderate'
  | 'Missing'
  | 'Negotiable'
  | 'Standard';

export type ReviewStatus = 'pending' | 'analyzing' | 'completed' | 'failed';

export type ReviewDecision = 'pending' | 'changes_requested' | 'approved';

export interface ReviewAssignee {
  id: string;
  name: string;
  email: string;
}

export interface ContractReviewFinding {
  severity: ReviewSeverity;
  title: string;
  excerpt: string;
  law: string;
  suggestion: string;
}

export interface ContractReviewSummary {
  id: string;
  firmId: string;
  caseId: string | null;
  documentId: string | null;
  perspective: ReviewPerspective;
  title: string;
  sourceFilename: string | null;
  status: ReviewStatus;
  riskScore: number | null;
  summary: string | null;
  provider: string | null;
  errorMessage: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  assignedTo: ReviewAssignee | null;
  decision: ReviewDecision | null;
  decidedAt: string | null;
  decidedBy: ReviewAssignee | null;
  commentCount: number;
}

export interface ContractReview extends ContractReviewSummary {
  sourceText: string;
  findings: ContractReviewFinding[];
}

export interface ReviewComment {
  id: string;
  reviewId: string;
  findingIndex: number | null;
  parentCommentId: string | null;
  author: ReviewAssignee | null;
  body: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateReviewLifecycleRequest {
  assignedTo?: string | null;
  decision?: ReviewDecision | null;
}

export interface CreateReviewCommentRequest {
  body: string;
  findingIndex?: number;
  parentCommentId?: string;
}

export interface ListContractReviewsResponse {
  items: ContractReviewSummary[];
}

export interface CreateContractReviewRequest {
  perspective: ReviewPerspective;
  sourceText: string;
  title?: string;
  sourceFilename?: string;
  caseId?: string;
  documentId?: string;
  provider?: 'xai' | 'anthropic';
}

const LIST_KEY = ['review', 'list'] as const;
const detailKey = (id: string) => ['review', 'detail', id] as const;

export function useReviews(caseId?: string) {
  return useQuery({
    queryKey: caseId ? ([...LIST_KEY, caseId] as const) : LIST_KEY,
    queryFn: () =>
      api.get<ListContractReviewsResponse>('/review', caseId ? { caseId } : undefined),
  });
}

/** Reviews assigned to the current user. Surfaces the reviewer's queue
 *  with a default sort: pending → changes_requested → approved. */
export function useMyReviews() {
  return useQuery({
    queryKey: ['review', 'mine'] as const,
    queryFn: () => api.get<ListContractReviewsResponse>('/review/mine'),
  });
}

export function useReview(id: string | null) {
  return useQuery({
    queryKey: id ? detailKey(id) : ['review', 'detail', 'none'],
    queryFn: () => api.get<ContractReview>(`/review/${id}`),
    enabled: !!id,
  });
}

export function useCreateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContractReviewRequest) =>
      api.post<ContractReview>('/review', input),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['review', 'list'] });
      qc.setQueryData(detailKey(created.id), created);
    },
  });
}

export function useDeleteReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/review/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review', 'list'] }),
  });
}

export function useUpdateReviewLifecycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateReviewLifecycleRequest }) =>
      api.patch<ContractReview>(`/review/${id}`, patch),
    onSuccess: (updated) => {
      qc.setQueryData(detailKey(updated.id), updated);
      qc.invalidateQueries({ queryKey: ['review', 'list'] });
    },
  });
}

// ---- Assignee picker -----------------------------------------------------

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
}

export function useAssignableUsers() {
  return useQuery({
    queryKey: ['review', 'assignable-users'],
    queryFn: () => api.get<{ items: AssignableUser[] }>('/review/assignable-users'),
  });
}

// ---- Comments ------------------------------------------------------------

const commentsKey = (reviewId: string) => ['review', 'comments', reviewId] as const;

export function useReviewComments(reviewId: string | null) {
  return useQuery({
    queryKey: reviewId ? commentsKey(reviewId) : ['review', 'comments', 'none'],
    queryFn: () => api.get<{ items: ReviewComment[] }>(`/review/${reviewId}/comments`),
    enabled: !!reviewId,
  });
}

export function useCreateReviewComment(reviewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReviewCommentRequest) =>
      api.post<ReviewComment>(`/review/${reviewId}/comments`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsKey(reviewId) });
      qc.invalidateQueries({ queryKey: detailKey(reviewId) });
      qc.invalidateQueries({ queryKey: ['review', 'list'] });
    },
  });
}

export function useUpdateReviewComment(reviewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      api.patch<ReviewComment>(`/review/${reviewId}/comments/${commentId}`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(reviewId) }),
  });
}

export function useDeleteReviewComment(reviewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      api.delete<ReviewComment>(`/review/${reviewId}/comments/${commentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsKey(reviewId) });
      qc.invalidateQueries({ queryKey: detailKey(reviewId) });
      qc.invalidateQueries({ queryKey: ['review', 'list'] });
    },
  });
}
