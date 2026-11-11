/** What to tell the advocate when a draft request fails. Only a 4xx is about
 *  their text; a timeout, rate limit or server fault must not read as
 *  "add more detail" (a full anticipatory-bail brief got that message). */
export function draftErrorMessage(err: unknown): string {
  const res = (err as { response?: { status?: number; data?: { message?: string; error?: string; code?: string } } })?.response;
  if (!res) return 'The draft took too long or the connection dropped. Your text is fine — please try again.';
  if (res.data?.error === 'ai_unavailable') return 'AI drafting is temporarily unavailable on DifAi. Your text is fine — please try again later.';
  if (res.data?.code === 'ai_quota_exceeded') return 'Your monthly drafting limit is reached. It renews at the start of your next cycle.';
  if (res.status === 429) return 'Too many drafts in a short time. Wait a minute, then try again.';
  if ((res.status ?? 500) >= 500) return 'Something went wrong on our side while drafting. Your text is fine — please try again in a moment.';
  return res.data?.message ?? 'Could not draft from that. Add a little more detail and try again.';
}
