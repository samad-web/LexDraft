import type { ImpersonationGrant } from '@lexdraft/types';
import { authService, issueImpersonationToken } from './auth.service';
import { auditService } from './audit.service';

export const impersonationService = {
  /** Issue a 30-minute impersonation token for the target user. The token is
   *  bound to the target's identity but carries an `actAs` claim with the
   *  admin's id+email so the frontend can show a banner and the API can
   *  block /admin routes. */
  async start(targetUserId: string, admin: { id: string; email: string }): Promise<ImpersonationGrant> {
    const target = await authService.getById(targetUserId);
    if (!target) throw Object.assign(new Error('Target user not found'), { status: 404 });
    if (target.isSuperadmin) {
      throw Object.assign(new Error('Cannot impersonate another superadmin'), { status: 403 });
    }
    const { token, expiresAt } = issueImpersonationToken(target, {
      adminId: admin.id, adminEmail: admin.email,
    });
    await auditService.write({
      actorUserId: admin.id, actorEmail: admin.email,
      action: 'user.impersonate.start', targetType: 'user', targetId: targetUserId,
      payload: { targetEmail: target.email },
    });
    return { token, user: target, expiresAt: expiresAt.toISOString(), originalAdminId: admin.id };
  },

  async end(admin: { id: string; email: string }, targetUserId: string | null): Promise<void> {
    await auditService.write({
      actorUserId: admin.id, actorEmail: admin.email,
      action: 'user.impersonate.end', targetType: 'user', targetId: targetUserId,
      payload: null,
    });
  },
};
