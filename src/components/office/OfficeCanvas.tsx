'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimStore } from '@/store/simulationStore';
import { simulationEngine } from '@/lib/simulation/engine';
import { OFFICE_HEIGHT, OFFICE_WIDTH } from '@/lib/simulation/config';
import type { AgentRole, AgentStatus } from '@/types';
import OfficeFurniture from './OfficeFurniture';
import AgentSprite from './AgentSprite';
import SpeechBubble from './SpeechBubble';

// ── status overlay icons ──────────────────────────────────────────────────────

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

const STATUS_META: Record<AgentStatus, { icon: string; label: string; color: string }> = {
  idle:      { icon: '💤', label: 'Idle',      color: '#64748B' },
  walking:   { icon: '🚶', label: 'Moving',    color: '#F97316' },
  thinking:  { icon: '🤔', label: 'Thinking',  color: '#C084FC' },
  coding:    { icon: '⌨️', label: 'Coding',    color: '#60A5FA' },
  reviewing: { icon: '🔍', label: 'Reviewing', color: '#34D399' },
  testing:   { icon: '🧪', label: 'Testing',   color: '#FB923C' },
  meeting:   { icon: '💬', label: 'Meeting',   color: '#38BDF8' },
  blocked:   { icon: '⛔', label: 'Blocked',   color: '#EF4444' },
};

// ── agent detail card ─────────────────────────────────────────────────────────

interface AgentCardProps {
  agentId: AgentRole;
  onClose: () => void;
}

function AgentDetailCard({ agentId, onClose }: AgentCardProps) {
  const agent  = useSimStore(s => s.agents[agentId]);
  const events = useSimStore(s => s.events.filter(e => e.agentId === agentId).slice(0, 4));
  const meta   = STATUS_META[agent.status];

  function fmtTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  }

  return (
    <div className="agent-detail-card" onClick={e => e.stopPropagation()}>

      {/* header */}
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>{agent.emoji}</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 'bold', color: agent.primaryColor, letterSpacing: 1 }}>
              {agent.name.toUpperCase()}
            </div>
            <div style={{ fontSize: 8, color: meta.color, marginTop: 1 }}>
              {meta.icon} {meta.label}
            </div>
          </div>
        </div>
        <button className="card-close" onClick={onClose}>✕</button>
      </div>

      {/* info rows */}
      <div className="card-row">
        <span className="card-label">Role</span>
        <span className="card-value">{agent.role}</span>
      </div>
      <div className="card-row">
        <span className="card-label">Task</span>
        <span className="card-value">{agent.currentTask ?? '—'}</span>
      </div>
      <div className="card-row">
        <span className="card-label">Completed</span>
        <span className="card-value" style={{ color: '#34D399' }}>✓ {agent.completedTasks}</span>
      </div>
      {agent.speech && (
        <div className="card-row">
          <span className="card-label">Says</span>
          <span className="card-value" style={{ color: '#94A3B8', fontStyle: 'italic' }}>
            &ldquo;{agent.speech}&rdquo;
          </span>
        </div>
      )}

      {/* recent events */}
      {events.length > 0 && (
        <div className="card-section">
          <div className="card-section-title">— RECENT EVENTS —</div>
          {events.map(e => (
            <div key={e.id} className="card-event-item">
              <span style={{ color: '#334155' }}>{fmtTime(e.timestamp)} </span>
              {e.message}
            </div>
          ))}
        </div>
      )}

      {/* trace placeholder */}
      <div className="card-section">
        <div className="card-section-title">— TRACE —</div>
        <div className="card-trace-placeholder">
          AgentOps trace · LangGraph node · coming in Milestone 3
        </div>
      </div>
    </div>
  );
}

// ── main canvas ──────────────────────────────────────────────────────────────

export default function OfficeCanvas() {
  const agents    = useSimStore(s => s.agents);
  const isRunning = useSimStore(s => s.isRunning);
  const started      = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLDivElement>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentRole | null>(null);

  // auto-scale via DOM ref — bypasses React batching delays
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

      {/* ── topbar: title + pause/start ── */}
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

      {/* ── sprint scenario control bar ── */}
      <div className="sprint-bar">
        <span className="sprint-bar-label">ACTIONS</span>
        <button
          className="sprint-btn sprint-btn-start"
          onClick={() => simulationEngine.startSprint()}
          title="새 스프린트 시작"
        >
          ▶ Start Sprint
        </button>
        <button
          className="sprint-btn sprint-btn-meeting"
          onClick={() => simulationEngine.callMeeting()}
          title="전체 미팅 소집"
        >
          💬 Call Meeting
        </button>
        <button
          className="sprint-btn sprint-btn-task"
          onClick={() => simulationEngine.createMockTask()}
          title="랜덤 태스크 추가"
        >
          + Add Task
        </button>
        <button
          className="sprint-btn sprint-btn-complete"
          onClick={() => simulationEngine.completeSprint()}
          title="스프린트 즉시 완료"
        >
          ✓ Complete
        </button>
        <button
          className="sprint-btn sprint-btn-reset"
          onClick={() => simulationEngine.resetOffice()}
          title="오피스 초기화"
        >
          ↺ Reset
        </button>
      </div>

      {/* ── scale-to-fit canvas area ── */}
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
        {/* fixed 860×500 canvas, integer-scaled */}
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
          <OfficeFurniture />

          {Object.values(agents).map(agent => (
            <div
              key={agent.id}
              style={{
                position:   'absolute',
                left:       agent.position.x,
                top:        agent.position.y,
                width:      32,
                height:     48,
                transition: agent.status === 'walking'
                  ? 'left 1.4s ease-in-out, top 1.4s ease-in-out'
                  : 'none',
                zIndex:  selectedAgent === agent.id ? 20 : 10,
                cursor:  'pointer',
              }}
              onClick={e => {
                e.stopPropagation();
                setSelectedAgent(prev => prev === agent.id ? null : agent.id);
              }}
            >
              {agent.speech && <SpeechBubble text={agent.speech} />}

              {/* status icon above sprite */}
              <div style={{
                position:  'absolute',
                top:       -16,
                left:      '50%',
                transform: 'translateX(-50%)',
                fontSize:  10,
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}>
                {STATUS_LABEL[agent.status] ?? ''}
              </div>

              <AgentSprite
                shirtColor={agent.spriteColor}
                pantColor={agent.pantColor}
                status={agent.status}
              />

              {/* name tag */}
              <div style={{
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
                border:       agent.status === 'blocked'
                  ? '1px solid #EF4444'
                  : '1px solid #0F172A',
              }}>
                {agent.emoji} {agent.name}
              </div>
            </div>
          ))}

          <div className="scanlines" />
        </div>

        {/* agent detail card (outside scaled canvas, in relative container) */}
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
