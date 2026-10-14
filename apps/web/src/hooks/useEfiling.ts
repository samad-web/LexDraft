import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

// =============================================================================
// useEfiling — TanStack Query bindings for the live eFiling gateway
// (filing.ecourts.gov.in). Backend lives at /api/efiling, documented in
// apps/api/src/routes/efiling.routes.ts. Mirrors useEcourts.ts's CNR-live
// session hooks exactly (same request/response shapes, same "sessionId may
// change on retry" caveat), with a login step added before the captcha step.
//
// SCOPE: login + CAPTCHA are real. Filing/upload return a 501 from the API
// until a real advocate login has been used to capture the post-login
// form's selectors — see efiling-live.service.ts's file header.
// =============================================================================

export type EfilingUserType = 'advocate' | 'litigant' | 'pleader' | 'clerk' | 'gov_auth' | 'insurance';

export function useStartEfilingSession() {
  return useMutation({
    mutationFn: ({ state, userType }: { state: string; userType: EfilingUserType }) =>
      api.post<{ sessionId: string }>('/efiling/live/session', { state, userType }),
  });
}

// The backend may transparently restart the session on a page crash (same
// behaviour as the eCourts CNR flow) and return a different sessionId than
// the one sent — always use the id the response hands back for subsequent
// calls, not the one passed in.
export function useSubmitEfilingCredentials() {
  return useMutation({
    mutationFn: ({ sessionId, username, password }: { sessionId: string; username: string; password: string }) =>
      api.post<{ captchaImageBase64: string; sessionId: string }>(`/efiling/live/session/${sessionId}/login`, { username, password }),
  });
}

export function useRefreshEfilingCaptcha() {
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ captchaImageBase64: string }>(`/efiling/live/session/${sessionId}/login/captcha/refresh`),
  });
}

export type EfilingLoginCaptchaResult =
  | { status: 'authenticated' }
  | { retry: true; captchaImageBase64: string; reason: string }
  | { duplicateLogin: true; captchaImageBase64: string; reason: string };

export function useSubmitEfilingLoginCaptcha() {
  return useMutation({
    mutationFn: ({ sessionId, captchaCode }: { sessionId: string; captchaCode: string }) =>
      api.post<EfilingLoginCaptchaResult>(`/efiling/live/session/${sessionId}/login/captcha`, { captchaCode }),
  });
}

// The advocate is already logged in elsewhere (eCourts allows only one
// active session per account) — this confirms the portal's own "logout
// other sessions" prompt. It re-collects the password (a separate form on
// the portal, not reused from the first login screen) plus a fresh captcha
// for that form specifically.
export type EfilingDuplicateLoginResult =
  | { status: 'authenticated' }
  | { retry: true; captchaImageBase64: string; reason: string };

export function useConfirmDuplicateEfilingLogin() {
  return useMutation({
    mutationFn: ({ sessionId, password, captchaCode }: { sessionId: string; password: string; captchaCode: string }) =>
      api.post<EfilingDuplicateLoginResult>(`/efiling/live/session/${sessionId}/login/duplicate`, { password, captchaCode }),
  });
}

export function useEndEfilingSession() {
  return useMutation({
    mutationFn: (sessionId: string) => api.post<{ ok: true }>(`/efiling/live/session/${sessionId}/end`),
  });
}
