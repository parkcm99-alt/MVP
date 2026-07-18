import type { AgentRole, Position } from '@/types';

export const OFFICE_WIDTH = 860;
export const OFFICE_HEIGHT = 500;

/** Center of each desk furniture piece */
export const DESK_CENTERS: Record<AgentRole, Position> = {
  planner:   { x: 100,  y: 100 },
  architect: { x: 370,  y: 100 },
  developer: { x: 640,  y: 100 },
  reviewer:  { x: 200,  y: 370 },
  qa:        { x: 620,  y: 370 },
};

/** Where agent sprite stands at their desk (top-left of 32×48 sprite) */
export const DESK_STAND: Record<AgentRole, Position> = {
  planner:   { x: 84,   y: 136 },
  architect: { x: 354,  y: 136 },
  developer: { x: 624,  y: 136 },
  reviewer:  { x: 184,  y: 406 },
  qa:        { x: 604,  y: 406 },
};

/** Meeting table bounding box (for furniture drawing) */
export const MEETING_TABLE = { x: 290, y: 210, w: 250, h: 110 };

/** Seats around the meeting table (top-left of 32×48 sprite) */
export const MEETING_SEATS: Position[] = [
  { x: 298, y: 162 },  // top-left
  { x: 380, y: 162 },  // top-right
  { x: 460, y: 162 },  // top-far
  { x: 256, y: 222 },  // left
  { x: 540, y: 222 },  // right
];

export const AGENTS_INIT = [
  {
    id: 'planner'   as AgentRole,
    name: 'Planner',
    role: 'planner'   as AgentRole,
    emoji: '📋',
    primaryColor: '#60A5FA',
    spriteColor: '#3B82F6',
    pantColor: '#1E3A8A',
    deskPosition: DESK_STAND.planner,
  },
  {
    id: 'architect' as AgentRole,
    name: 'Architect',
    role: 'architect' as AgentRole,
    emoji: '🏗️',
    primaryColor: '#34D399',
    spriteColor: '#10B981',
    pantColor: '#064E3B',
    deskPosition: DESK_STAND.architect,
  },
  {
    id: 'developer' as AgentRole,
    name: 'Developer',
    role: 'developer' as AgentRole,
    emoji: '💻',
    primaryColor: '#FB923C',
    spriteColor: '#F97316',
    pantColor: '#431407',
    deskPosition: DESK_STAND.developer,
  },
  {
    id: 'reviewer'  as AgentRole,
    name: 'Reviewer',
    role: 'reviewer'  as AgentRole,
    emoji: '🔍',
    primaryColor: '#C084FC',
    spriteColor: '#A855F7',
    pantColor: '#3B0764',
    deskPosition: DESK_STAND.reviewer,
  },
  {
    id: 'qa'        as AgentRole,
    name: 'QA',
    role: 'qa'        as AgentRole,
    emoji: '🧪',
    primaryColor: '#F87171',
    spriteColor: '#EF4444',
    pantColor: '#7F1D1D',
    deskPosition: DESK_STAND.qa,
  },
] as const;
