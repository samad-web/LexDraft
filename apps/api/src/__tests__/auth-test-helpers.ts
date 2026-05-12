import { authService, isMfaChallenge, type AuthResponseWithMfa } from '../services/auth.service';
import type { SignInRequest, SignUpRequest } from '@lexdraft/types';

/**
 * Test-only wrapper that calls authService.signIn and narrows the
 * SignInResult union to the success shape. Tests run without any MFA
 * enrolment, so the challenge branch should never fire — if it does, that
 * itself is a regression and we want the test to fail loudly here rather
 * than at the downstream `.user.id` access.
 */
export async function signInForTest(input: SignInRequest): Promise<AuthResponseWithMfa> {
  const r = await authService.signIn(input);
  if (isMfaChallenge(r)) {
    throw new Error('signInForTest: unexpected MFA challenge — tests assume no MFA enrolment');
  }
  return r;
}

/**
 * Same wrapper for signUp. signUp's return type didn't change with the MFA
 * work (newly-created users can't already be MFA-enrolled), but keeping
 * the test usage uniform across signIn/signUp paths.
 */
export async function signUpForTest(input: SignUpRequest): Promise<AuthResponseWithMfa> {
  return authService.signUp(input);
}
