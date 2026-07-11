import type { AgentRole } from '@/types';

export interface PlannerStepTaskSpec {
  assignedTo: AgentRole;
  title: string;
  originalStep: string;
}

const ROLE_LABELS: Record<AgentRole, string> = {
  planner: 'Planner',
  architect: 'Architect',
  developer: 'Developer',
  reviewer: 'Reviewer',
  qa: 'QA',
};

const EXPLICIT_ROLE_PATTERNS: Array<[AgentRole, RegExp]> = [
  ['architect', /(architect에게|architect to|assign to architect|아키텍트에게)/i],
  ['developer', /(developer에게|developer to|assign to developer|개발자에게)/i],
  ['reviewer', /(reviewer에게|reviewer to|assign to reviewer|리뷰어에게)/i],
  ['qa', /(qa에게|qa to|assign to qa|테스터에게)/i],
  ['planner', /(planner에게|planner to|assign to planner|기획자에게)/i],
];

const ROLE_KEYWORDS: Array<[AgentRole, RegExp]> = [
  ['architect', /(architect|아키텍처|구조|설계|데이터\s*흐름|구현\s*경계)/i],
  ['developer', /(developer|개발|구현|api|코드|백엔드|프론트엔드|frontend|backend)/i],
  ['reviewer', /(reviewer|리뷰|검토|pr|코드\s*리뷰|code\s*review)/i],
  ['qa', /(\bqa\b|테스트|검증|회귀|품질|test|verification|quality)/i],
  ['planner', /(요구사항|우선순위|기획|스프린트|requirement|priority|planning|sprint)/i],
];

const MULTI_ROLE_PATTERNS: Array<[AgentRole, RegExp]> = [
  ['architect', /\barchitect\b|아키텍처|아키텍트/i],
  ['developer', /\bdeveloper\b|개발자|개발/i],
  ['reviewer', /\breviewer\b|리뷰어|리뷰/i],
  ['qa', /\bqa\b|테스터|테스트/i],
  ['planner', /\bplanner\b|기획자|기획/i],
];

function truncateTitle(value: string, maxLength = 24): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function summarizeStepForRole(step: string, role: AgentRole): string {
  const cleaned = step
    .replace(/^\d+[\).]\s*/, '')
    .replace(/^[-*]\s*/, '')
    .trim();

  const withoutLeadingRole = cleaned.replace(/^(architect|developer|reviewer|qa|planner)\s*[:/-]\s*/i, '');
  const title = truncateTitle(withoutLeadingRole || cleaned);
  return `${ROLE_LABELS[role]}: ${title}`;
}

function findExplicitRole(step: string): AgentRole | null {
  return EXPLICIT_ROLE_PATTERNS.find(([, pattern]) => pattern.test(step))?.[0] ?? null;
}

function findKeywordRole(step: string): AgentRole {
  return ROLE_KEYWORDS.find(([, pattern]) => pattern.test(step))?.[0] ?? 'planner';
}

function findMentionedRoles(step: string): AgentRole[] {
  const roles = MULTI_ROLE_PATTERNS
    .filter(([, pattern]) => pattern.test(step))
    .map(([role]) => role);

  return [...new Set(roles)];
}

export function assignPlannerStep(step: string): PlannerStepTaskSpec[] {
  const originalStep = step.trim();
  if (!originalStep) return [];

  const explicitRole = findExplicitRole(originalStep);
  if (explicitRole) {
    return [{
      assignedTo: explicitRole,
      title: summarizeStepForRole(originalStep, explicitRole),
      originalStep,
    }];
  }

  const mentionedRoles = findMentionedRoles(originalStep);
  if (mentionedRoles.length > 1) {
    return mentionedRoles.map(role => ({
      assignedTo: role,
      title: summarizeStepForRole(originalStep, role),
      originalStep,
    }));
  }

  const assignedTo = mentionedRoles[0] ?? findKeywordRole(originalStep);
  return [{
    assignedTo,
    title: summarizeStepForRole(originalStep, assignedTo),
    originalStep,
  }];
}
