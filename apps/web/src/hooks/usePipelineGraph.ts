import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CasePipelineGraph, PipelineNode, PipelineEdge, PipelineNodeStatus } from '@lexdraft/types';
import { api } from '@/lib/api';

// Per-case pipeline graph (migration 0054). The GET returns the graph object
// directly; every mutation returns the full refreshed graph so we can replace
// the cache without a second round trip.

export interface NewNodeInput {
  label: string;
  x: number;
  y: number;
  applicationId?: string | null;
}
export interface NodePatchInput {
  label?: string;
  x?: number;
  y?: number;
  applicationId?: string | null;
}
export interface NewEdgeInput {
  fromNodeId: string;
  toNodeId: string;
  conditionLabel?: string | null;
}

interface NodeResult { node: PipelineNode; graph: CasePipelineGraph }
interface EdgeResult { edge: PipelineEdge; graph: CasePipelineGraph }
interface GraphResult { graph: CasePipelineGraph }

const key = (id: string) => ['cases', id, 'pipeline'] as const;

export function useCasePipeline(id: string | null | undefined) {
  return useQuery({
    queryKey: ['cases', id, 'pipeline'],
    queryFn: () => api.get<CasePipelineGraph>(`/cases/${id}/pipeline`),
    enabled: !!id,
  });
}

export function useAddPipelineNode(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewNodeInput) =>
      api.post<NodeResult>(`/cases/${caseId}/pipeline/nodes`, input),
    onSuccess: (data) => qc.setQueryData(key(caseId), data.graph),
  });
}

export function useUpdatePipelineNode(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, patch }: { nodeId: string; patch: NodePatchInput }) =>
      api.patch<NodeResult>(`/cases/${caseId}/pipeline/nodes/${nodeId}`, patch),
    onSuccess: (data) => qc.setQueryData(key(caseId), data.graph),
  });
}

export function useDeletePipelineNode(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) =>
      api.delete<GraphResult>(`/cases/${caseId}/pipeline/nodes/${nodeId}`),
    onSuccess: (data) => qc.setQueryData(key(caseId), data.graph),
  });
}

export function useSetNodeStatus(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, status, note, visibleToPortal }: {
      nodeId: string;
      status: PipelineNodeStatus;
      note?: string;
      visibleToPortal?: boolean;
    }) =>
      api.post<NodeResult>(`/cases/${caseId}/pipeline/nodes/${nodeId}/status`, {
        status, note, visibleToPortal,
      }),
    onSuccess: (data) => {
      qc.setQueryData(key(caseId), data.graph);
      // Advancing syncs cases.stage and writes a diary entry.
      qc.invalidateQueries({ queryKey: ['cases', caseId] });
      qc.invalidateQueries({ queryKey: ['cases', caseId, 'timeline'] });
    },
  });
}

export function useAddPipelineEdge(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewEdgeInput) =>
      api.post<EdgeResult>(`/cases/${caseId}/pipeline/edges`, input),
    onSuccess: (data) => qc.setQueryData(key(caseId), data.graph),
  });
}

export function useUpdatePipelineEdge(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ edgeId, conditionLabel }: { edgeId: string; conditionLabel: string | null }) =>
      api.patch<EdgeResult>(`/cases/${caseId}/pipeline/edges/${edgeId}`, { conditionLabel }),
    onSuccess: (data) => qc.setQueryData(key(caseId), data.graph),
  });
}

export function useDeletePipelineEdge(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (edgeId: string) =>
      api.delete<GraphResult>(`/cases/${caseId}/pipeline/edges/${edgeId}`),
    onSuccess: (data) => qc.setQueryData(key(caseId), data.graph),
  });
}
