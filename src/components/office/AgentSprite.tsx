'use client';

import type { AgentStatus } from '@/types';

interface Props {
  shirtColor: string;
  pantColor: string;
  status: AgentStatus;
  /** flip sprite horizontally when walking left */
  flipX?: boolean;
}

export default function AgentSprite({ shirtColor, pantColor, status, flipX = false }: Props) {
  const skin  = '#FBBF24';
  const hair  = '#374151';
  const eye   = '#111827';
  const shoe  = '#111827';
  const white = '#FFFFFF';
  const belt  = '#1F2937';

  const animClass =
    status === 'walking'  ? 'animate-agent-walk'  :
    status === 'working'  ? 'animate-agent-work'  :
    status === 'thinking' ? 'animate-agent-think' :
    status === 'meeting'  ? 'animate-agent-meet'  : '';

  return (
    <svg
      width="32"
      height="48"
      xmlns="http://www.w3.org/2000/svg"
      className={animClass}
      style={{
        imageRendering: 'pixelated',
        transform: flipX ? 'scaleX(-1)' : undefined,
        display: 'block',
      }}
    >
      {/* ── hair ── */}
      <rect x="8"  y="0" width="16" height="4" fill={hair} />
      {/* ── ears ── */}
      <rect x="6"  y="5" width="2"  height="6" fill={skin} />
      <rect x="24" y="5" width="2"  height="6" fill={skin} />
      {/* ── face ── */}
      <rect x="8"  y="3" width="16" height="14" fill={skin} />
      {/* ── eyes ── */}
      <rect x="11" y="7" width="3"  height="4"  fill={eye} />
      <rect x="18" y="7" width="3"  height="4"  fill={eye} />
      {/* eye shine */}
      <rect x="13" y="7" width="1"  height="1"  fill={white} />
      <rect x="20" y="7" width="1"  height="1"  fill={white} />
      {/* ── mouth ── */}
      <rect x="12" y="13" width="8" height="2"  fill="#DC2626" />
      {/* ── neck ── */}
      <rect x="13" y="17" width="6" height="3"  fill={skin} />
      {/* ── body (shirt) ── */}
      <rect x="6"  y="16" width="20" height="16" fill={shirtColor} />
      {/* collar */}
      <rect x="11" y="16" width="10" height="5"  fill={white} />
      {/* ── left arm ── */}
      <rect x="0"  y="18" width="6"  height="12" fill={shirtColor} />
      {/* ── right arm ── */}
      <rect x="26" y="18" width="6"  height="12" fill={shirtColor} />
      {/* ── hands ── */}
      <rect x="0"  y="30" width="6"  height="4"  fill={skin} />
      <rect x="26" y="30" width="6"  height="4"  fill={skin} />
      {/* ── belt ── */}
      <rect x="6"  y="32" width="20" height="3"  fill={belt} />
      {/* ── pants ── */}
      <rect x="6"  y="35" width="8"  height="9"  fill={pantColor} />
      <rect x="18" y="35" width="8"  height="9"  fill={pantColor} />
      {/* ── shoes ── */}
      <rect x="4"  y="44" width="12" height="4"  fill={shoe} />
      <rect x="16" y="44" width="12" height="4"  fill={shoe} />
    </svg>
  );
}
