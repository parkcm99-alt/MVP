/**
 * Role-based Claude model selector.
 *
 * Resolution order (first non-empty value wins):
 *   1. CLAUDE_<ROLE>_MODEL  (role-specific override)
 *   2. CLAUDE_MODEL         (global default)
 *   3. DEFAULT_CLAUDE_MODEL (hardcoded stable fallback — never changes without a release)
 *
 * This lets operators assign lighter models (e.g. Haiku) to Reviewer / QA
 * without touching code:
 *   CLAUDE_REVIEWER_MODEL=claude-haiku-4-20250514
 *   CLAUDE_QA_MODEL=claude-haiku-4-20250514
 *
 * IMPORTANT: This module is server-only. Do not import from Client Components.
 */

import 'server-only';

import type { AgentRole } from '@/types';
import { DEFAULT_CLAUDE_MODEL } from './claudeClient';

const ROLE_ENV_KEYS: Record<AgentRole, string> = {
  planner:   'CLAUDE_PLANNER_MODEL',
  architect: 'CLAUDE_ARCHITECT_MODEL',
  developer: 'CLAUDE_DEVELOPER_MODEL',
  reviewer:  'CLAUDE_REVIEWER_MODEL',
  qa:        'CLAUDE_QA_MODEL',
};

/**
 * Returns the Claude model name to use for the given agent role.
 *
 * @example
 * // With CLAUDE_REVIEWER_MODEL=claude-haiku-4-20250514 set:
 * getModelForRole('reviewer') // → 'claude-haiku-4-20250514'
 * getModelForRole('planner')  // → process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL
 */
export function getModelForRole(role: AgentRole): string {
  const roleEnvKey  = ROLE_ENV_KEYS[role];
  const roleModel   = process.env[roleEnvKey]?.trim();
  const globalModel = process.env.CLAUDE_MODEL?.trim();

  return roleModel || globalModel || DEFAULT_CLAUDE_MODEL;
}
