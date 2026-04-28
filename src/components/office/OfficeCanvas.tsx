'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimStore } from '@/store/simulationStore';
import { simulationEngine } from '@/lib/simulation/engine';
import { OFFICE_HEIGHT, OFFICE_WIDTH } from '@/lib/simulation/config';
import type { AgentRole, AgentStatus } from '@/types';
import OfficeFurniture from './OfficeFurniture';
import AgentSprite from './AgentSprite';
import SpeechBubble from './SpeechBubble';

// ── status overlay icons & state effect labels ─────────────────────────────

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle:      '💤',
  walking:   '🚶',
  thinking:  '🤔',
  coding:    '⌨️',
  reviewing: '🔍',
  testing:   '🧪',
  meeting:   '💬',
  blocked:   '⛔',
};

// ── agent detail card ──────────────────────────────────────────────────────

interface AgentCardProps {
  agentId: AgentRole;
  onClose: () => void;
}

function AgentDetailCard({ agentId, onClose }: AgentCardProps) {
  const agent  = useSimStore(s => s.agents[agentId]);
  const events = useSimStore(s => s.events.filter(e => e.agentId === agentId).slice(0, 5));

  const statusMeta: Record<AgentStatus, { icon: string; label: string; color: string }> = {
    idle:      { icon: '💤', label: 'Idle',      color: '#64748B' },
    walking:   { icon: '🚶', label: 'Moving',    color: '#F97316' },
    thinking:  { icon: '🤔', label: 'Thinking',  color: '#C084FC' },
    coding:    { icon: '⌨️', label: 'Coding',    color: '#60A5FA' },
    reviewing: { icon: '🔍', label: 'Reviewing', color: '#34D399' },
    testing:   { icon: '🧪', label: 'Testing',   color: '#FB923C' },
    meeting:   { icon: '💬', label: 'Meeting',   color: '#38BDF8' },
    blocked:   { icon: '⛔', label: 'Blocked',   color: '#EF4444' },
  };
  const meta = statusMeta[agent.status];

  function fmtTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  }

  return (
    <div className="agent-detail-card" onClick={e => e.stopPropagation()}>
      {/* header */}
      <div className="card-header">
        <span style={{ fontSize: 10, fontWeight: 'bold', color: agent.primaryColor }}>
          {agent.emoji} {agent.name.toUpperCase()}
        </span>
        <button className="card-close" onClick={onClose}>✕</button>
      </div>

      {/* rows */}
      <div className="card-row">
        <span>Role</span>
        <span>{agent.role}</span>
      </div>
      <div className="card-row">
        <span>Status</span>
        <span style={{ color: meta.color }}>{meta.icon} {meta.label}</span>
      </div>
      <div className="card-row">
        <span>Task</span>
        <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
          {agent.currentTask ?? '—'}
        </span>
      </div>
      <div className="card-row">
        <span>Done</span>
        <span style={{ color: '#34D399' }}>✓ {agent.completedTasks}</span>
      </div>

      {/* recent events */}
      {events.length > 0 && (
        <div className="card-events">
          <div style={{ fontSize: 8, color: '#475569', marginBottom: 4, letterSpacing: 1 }}>— RECENT —</div>
          {events.map(e => (
            <div key={e.id} className="card-event-item">
              <span style={{ color: '#334155' }}>{fmtTime(e.timestamp)} </span>
              {e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── main canvas component ─────────────────────────────────────────────────

export default function OfficeCanvas() {
  const agents    = useSimStore(s => s.agents);
  const isRunning = useSimStore(s => s.isRunning);
  const started     = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLDivElement>(null);

  const [selectedAgent, setSelectedAgent] = useState<AgentRole | null>(null);

  // auto-scale canvas directly via DOM ref — bypasses React batching delays
  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;

    const applyScale = () => {
      const { width, height } = container.getBoundingClientRect();
      const raw   = Math.min(width / OFFICE_WIDTH, height / OFFICE_HEIGHT);
      const scale = Math.max(1, Math.floor(raw));
      canvas.style.transform = `scale(${scale})`;
    };

    applyScale();
    const obs = new ResizeObserver(applyScale);
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      simulationEngine.start();
    }
    return () => simulationEngine.stop();
  }, []);

  return (
    <div className="office-wrapper">
      {/* control bar */}
      <div className="office-topbar">
        <span className="office-title">🏢 AI AGENT OFFICE</span>
        <div className="office-controls">
          <div className={`status-dot ${isRunning ? 'running' : 'stopped'}`} />
          <span className="status-text">{isRunning ? 'RUNNING' : 'STOPPED'}</span>
          <button
            className="ctrl-btn"
            onClick={() => isRunning ? simulationEngine.stop() : simulationEngine.start()}
          >
            {isRunning ? '⏸ PAUSE' : '▶ START'}
          </button>
        </div>
      </div>

      {/* sprint scenario buttons */}
      <div className="sprint-bar">
        <span className="sprint-bar-label">CTRL:</span>
        <button className="ctrl-btn-sm green"  onClick={() => simulationEngine.startSprint()}>
          ▶ Start Sprint
        </button>
        <button className="ctrl-btn-sm blue"   onClick={() => simulationEngine.callMeeting()}>
          💬 Call Meeting
        </button>
        <button className="ctrl-btn-sm orange" onClick={() => simulationEngine.createMockTask()}>
          + Add Task
        </button>
        <button className="ctrl-btn-sm orange" onClick={() => simulationEngine.completeSprint()}>
          ✓ Complete Sprint
        </button>
        <button className="ctrl-btn-sm red"    onClick={() => simulationEngine.resetOffice()}>
          ↺ Reset
        </button>
      </div>

      {/* scale-to-fit container */}
      <div
        ref={containerRef}
        style={{
          flex:       1,
          minHeight:  0,
          overflow:   'hidden',
          background: '#0F172A',
          position:   'relative',
        }}
        onClick={() => setSelectedAgent(null)}
      >
        {/* fixed-size canvas, scaled to fit via DOM ref */}
        <div
          ref={canvasRef}
          style={{
            width:           OFFICE_WIDTH,
            height:          OFFICE_HEIGHT,
            position:        'absolute',
            top:             0,
            left:            0,
            transformOrigin: 'top left',
            transform:       'scale(1)',
            overflow:        'hidden',
          }}
        >
          {/* static background furniture */}
          <OfficeFurniture />

          {/* agents */}
          {Object.values(agents).map(agent => (
            <div
              key={agent.id}
              style={{
                position:   'absolute',
                left:       agent.position.x,
                top:        agent.position.y,
                width:      32,
                height:     48,
                transition: agent.status === 'walking' ? 'left 1.4s ease-in-out, top 1.4s ease-in-out' : 'none',
                zIndex:     selectedAgent === agent.id ? 20 : 10,
                cursor:     'pointer',
              }}
              onClick={e => {
                e.stopPropagation();
                setSelectedAgent(prev => prev === agent.id ? null : agent.id);
              }}
            >
              {/* speech bubble */}
              {agent.speech && <SpeechBubble text={agent.speech} />}

              {/* status indicator */}
              <div
                style={{
                  position:  'absolute',
                  top:       -16,
                  left:      '50%',
                  transform: 'translateX(-50%)',
                  fontSize:  10,
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {STATUS_LABEL[agent.status] ?? ''}
              </div>

              {/* pixel sprite */}
              <AgentSprite
                shirtColor={agent.spriteColor}
                pantColor={agent.pantColor}
                status={agent.status}
              />

              {/* name tag */}
              <div
                style={{
                  position:     'absolute',
                  bottom:       -14,
                  left:         '50%',
                  transform:    'translateX(-50%)',
                  background:   agent.status === 'blocked' ? '#7F1D1D' : agent.primaryColor,
                  color:        '#0F172A',
                  fontSize:     7,
                  fontFamily:   'monospace',
                  fontWeight:   'bold',
                  padding:      '1px 4px',
                  borderRadius: 2,
                  whiteSpace:   'nowrap',
                  border:       agent.status === 'blocked' ? '1px solid #EF4444' : '1px solid #0F172A',
                }}
              >
                {agent.emoji} {agent.name}
              </div>
            </div>
          ))}

          {/* CRT scanline overlay */}
          <div className="scanlines" />
        </div>

        {/* agent detail card (rendered outside scaled canvas) */}
        {selectedAgent && (
          <AgentDetailCard
            agentId={selectedAgent}
            onClose={() => setSelectedAgent(null)}
          />
        )}
      </div>
    </div>
  );
}
