/**
 * Moved to `@resurv/node-runtime` in Phase 2, when the live CLI needed the same loader and a
 * product package depending on a probe package would have been the wrong shape. This module
 * stays so the seam probe's committed imports keep resolving, and it adds nothing.
 */
export {
  type CandidateProbe,
  type Credential,
  credentialShapedEnvNames,
  describeCredential,
  LOCAL_ENV_CANDIDATES,
  type LocalEnvLoad,
  loadLocalEnv,
  REPO_ROOT,
  readKeeperhubCredential,
} from '@resurv/node-runtime';
