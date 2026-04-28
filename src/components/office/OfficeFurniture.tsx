'use client';

import { DESK_CENTERS, MEETING_TABLE, OFFICE_HEIGHT, OFFICE_WIDTH } from '@/lib/simulation/config';
import type { AgentRole } from '@/types';

const DESK_LABELS: Record<AgentRole, string> = {
  planner:   'PLANNER',
  architect: 'ARCHITECT',
  developer: 'DEVELOPER',
  reviewer:  'REVIEWER',
  qa:        'QA',
};

const DESK_SCREEN_COLORS: Record<AgentRole, string> = {
  planner:   '#3B82F6',
  architect: '#10B981',
  developer: '#F97316',
  reviewer:  '#A855F7',
  qa:        '#EF4444',
};

function Desk({ cx, cy, label, screenColor }: { cx: number; cy: number; label: string; screenColor: string }) {
  const dw = 88; const dh = 48;
  const mx = cx - dw / 2; const my = cy - dh / 2;

  return (
    <g>
      {/* desk surface */}
      <rect x={mx} y={my + 16} width={dw} height={dh - 16} fill="#92400E" rx="2" />
      <rect x={mx} y={my + 16} width={dw} height="5" fill="#B45309" rx="2" />
      {/* monitor body */}
      <rect x={mx + 12} y={my} width={64} height={38} fill="#1E293B" rx="2" />
      {/* screen */}
      <rect x={mx + 14} y={my + 2} width={60} height={34} fill="#0F172A" />
      {/* screen glow lines */}
      <rect x={mx + 16} y={my + 5}  width={36} height="2" fill={screenColor} opacity="0.9" />
      <rect x={mx + 16} y={my + 9}  width={24} height="2" fill={screenColor} opacity="0.7" />
      <rect x={mx + 16} y={my + 13} width={40} height="2" fill={screenColor} opacity="0.8" />
      <rect x={mx + 16} y={my + 17} width={20} height="2" fill={screenColor} opacity="0.6" />
      <rect x={mx + 16} y={my + 21} width={32} height="2" fill={screenColor} opacity="0.7" />
      <rect x={mx + 16} y={my + 25} width={16} height="2" fill={screenColor} opacity="0.5" />
      {/* monitor stand */}
      <rect x={mx + 36} y={my + 38} width={16} height="8" fill="#374151" />
      <rect x={mx + 28} y={my + 44} width={32} height="4" fill="#4B5563" rx="1" />
      {/* keyboard */}
      <rect x={mx + 6} y={my + 26} width={76} height="14" fill="#D1D5DB" rx="2" />
      <rect x={mx + 8} y={my + 28} width={72} height="10" fill="#9CA3AF" rx="1" />
      {/* label */}
      <text x={cx} y={my + dh + 14} textAnchor="middle" fill="#94A3B8" fontSize="8" fontFamily="monospace" letterSpacing="1">
        {label}
      </text>
    </g>
  );
}

function MeetingTable() {
  const { x, y, w, h } = MEETING_TABLE;
  const chairs: { cx: number; cy: number }[] = [
    { cx: x + w * 0.2, cy: y - 16 },
    { cx: x + w * 0.5, cy: y - 16 },
    { cx: x + w * 0.8, cy: y - 16 },
    { cx: x + w * 0.2, cy: y + h + 16 },
    { cx: x + w * 0.5, cy: y + h + 16 },
    { cx: x + w * 0.8, cy: y + h + 16 },
    { cx: x - 16,      cy: y + h * 0.5 },
    { cx: x + w + 16,  cy: y + h * 0.5 },
  ];

  return (
    <g>
      {/* shadow */}
      <rect x={x + 4} y={y + 4} width={w} height={h} fill="#0F172A" opacity="0.4" rx="6" />
      {/* table body */}
      <rect x={x} y={y} width={w} height={h} fill="#78350F" rx="6" />
      {/* surface sheen */}
      <rect x={x} y={y} width={w} height="10" fill="#92400E" rx="6" />
      {/* wood grain */}
      {[20, 38, 56, 74, 92].map(offset => (
        <rect key={offset} x={x + 16} y={y + offset} width={w - 32} height="2" fill="#92400E" opacity="0.35" rx="1" />
      ))}
      {/* chairs */}
      {chairs.map(({ cx, cy }, i) => (
        <rect key={i} x={cx - 12} y={cy - 10} width={24} height={20} fill="#334155" rx="3" />
      ))}
      {/* label */}
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fill="#D97706" fontSize="9" fontFamily="monospace" fontWeight="bold" letterSpacing="2">
        MEETING ROOM
      </text>
    </g>
  );
}

export default function OfficeFurniture() {
  return (
    <svg
      width={OFFICE_WIDTH}
      height={OFFICE_HEIGHT}
      xmlns="http://www.w3.org/2000/svg"
      style={{ position: 'absolute', top: 0, left: 0, imageRendering: 'pixelated' }}
    >
      <defs>
        {/* checkerboard floor */}
        <pattern id="floor" width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="#1E293B" />
          <rect width="16" height="16" fill="#172033" />
          <rect x="16" y="16" width="16" height="16" fill="#172033" />
        </pattern>
        {/* wall stripe */}
        <pattern id="wall" width="64" height="32" patternUnits="userSpaceOnUse">
          <rect width="64" height="32" fill="#0F172A" />
          <rect width="64" height="2"  fill="#1E293B" />
        </pattern>
      </defs>

      {/* floor */}
      <rect width={OFFICE_WIDTH} height={OFFICE_HEIGHT} fill="url(#floor)" />

      {/* top wall */}
      <rect x="0" y="0" width={OFFICE_WIDTH} height="28" fill="url(#wall)" />
      {/* baseboard accent */}
      <rect x="0" y="26" width={OFFICE_WIDTH} height="3" fill="#334155" />

      {/* windows in top wall */}
      {[80, 220, 380, 520, 680].map(wx => (
        <g key={wx}>
          <rect x={wx} y="4" width="72" height="18" fill="#0EA5E9" opacity="0.3" rx="1" />
          <rect x={wx} y="4" width="72" height="18" fill="none" stroke="#0EA5E9" strokeWidth="1" opacity="0.6" rx="1" />
          <line x1={wx + 36} y1="4" x2={wx + 36} y2="22" stroke="#0EA5E9" strokeWidth="1" opacity="0.4" />
          <line x1={wx} y1="13" x2={wx + 72} y2="13" stroke="#0EA5E9" strokeWidth="1" opacity="0.4" />
        </g>
      ))}

      {/* floor dividers */}
      <line x1="0" y1="175" x2={OFFICE_WIDTH} y2="175" stroke="#334155" strokeWidth="1" opacity="0.5" />
      <line x1="0" y1="340" x2={OFFICE_WIDTH} y2="340" stroke="#334155" strokeWidth="1" opacity="0.5" />

      {/* corner plants */}
      <g transform="translate(14,430)">
        <rect x="4" y="24" width="16" height="12" fill="#78350F" rx="2" />
        <ellipse cx="12" cy="24" rx="12" ry="10" fill="#166534" />
        <ellipse cx="6"  cy="18" rx="8"  ry="7"  fill="#15803D" />
        <ellipse cx="18" cy="18" rx="8"  ry="7"  fill="#15803D" />
      </g>
      <g transform={`translate(${OFFICE_WIDTH - 38},430)`}>
        <rect x="4" y="24" width="16" height="12" fill="#78350F" rx="2" />
        <ellipse cx="12" cy="24" rx="12" ry="10" fill="#166534" />
        <ellipse cx="6"  cy="18" rx="8"  ry="7"  fill="#15803D" />
        <ellipse cx="18" cy="18" rx="8"  ry="7"  fill="#15803D" />
      </g>

      {/* desks */}
      {(Object.keys(DESK_CENTERS) as AgentRole[]).map(role => (
        <Desk
          key={role}
          cx={DESK_CENTERS[role].x}
          cy={DESK_CENTERS[role].y}
          label={DESK_LABELS[role]}
          screenColor={DESK_SCREEN_COLORS[role]}
        />
      ))}

      {/* meeting table */}
      <MeetingTable />

      {/* whiteboard on top wall */}
      <rect x="340" y="32" width="180" height="60" fill="#F1F5F9" rx="2" />
      <rect x="340" y="32" width="180" height="60" fill="none" stroke="#475569" strokeWidth="2" rx="2" />
      <text x="430" y="55" textAnchor="middle" fill="#1E293B" fontSize="8" fontFamily="monospace" fontWeight="bold">SPRINT BOARD</text>
      <rect x="350" y="62" width="40" height="20" fill="#FEF3C7" rx="1" stroke="#D97706" strokeWidth="1" />
      <rect x="398" y="62" width="40" height="20" fill="#DCFCE7" rx="1" stroke="#16A34A" strokeWidth="1" />
      <rect x="446" y="62" width="40" height="20" fill="#EDE9FE" rx="1" stroke="#7C3AED" strokeWidth="1" />
      <text x="370" y="76" textAnchor="middle" fill="#92400E" fontSize="7" fontFamily="monospace">TODO</text>
      <text x="418" y="76" textAnchor="middle" fill="#166534" fontSize="7" fontFamily="monospace">WIP</text>
      <text x="466" y="76" textAnchor="middle" fill="#5B21B6" fontSize="7" fontFamily="monospace">DONE</text>
    </svg>
  );
}
