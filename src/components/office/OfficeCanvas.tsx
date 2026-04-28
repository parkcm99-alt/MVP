'use client';

import { useEffect, useRef } from 'react';
import { useSimStore } from '@/store/simulationStore';
import { simulationEngine } from '@/lib/simulation/engine';
import { OFFICE_HEIGHT, OFFICE_WIDTH } from '@/lib/simulation/config';
import OfficeFurniture from './OfficeFurniture';
import AgentSprite from './AgentSprite';
import SpeechBubble from './SpeechBubble';

const STATUS_LABEL: Record<string, string> = {
  idle:     '💤',
  working:  '⚙️',
  walking:  '🚶',
  meeting:  '💬',
  thinking: '🤔',
};

export default function OfficeCanvas() {
  const agents      = useSimStore(s => s.agents);
  const isRunning   = useSimStore(s => s.isRunning);
  const started     = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLDivElement>(null);

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
            transform:       'scale(1)',   // initial; updated by ResizeObserver
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
                zIndex:     10,
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
                  background:   agent.primaryColor,
                  color:        '#0F172A',
                  fontSize:     7,
                  fontFamily:   'monospace',
                  fontWeight:   'bold',
                  padding:      '1px 4px',
                  borderRadius: 2,
                  whiteSpace:   'nowrap',
                  border:       '1px solid #0F172A',
                }}
              >
                {agent.emoji} {agent.name}
              </div>
            </div>
          ))}

          {/* CRT scanline overlay */}
          <div className="scanlines" />
        </div>
      </div>
    </div>
  );
}
