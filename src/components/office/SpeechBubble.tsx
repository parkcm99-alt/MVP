'use client';

interface Props {
  text: string;
  /** which side the tail points — default 'bottom' */
  tail?: 'bottom' | 'left';
}

export default function SpeechBubble({ text, tail = 'bottom' }: Props) {
  return (
    <div
      className="speech-bubble"
      style={{
        position: 'absolute',
        bottom: tail === 'bottom' ? '54px' : undefined,
        left: tail === 'bottom' ? '50%' : undefined,
        transform: tail === 'bottom' ? 'translateX(-50%)' : undefined,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 30,
        animation: 'bubbleIn 0.15s ease-out',
      }}
    >
      <div
        style={{
          background: '#F8FAFC',
          border: '2px solid #1E293B',
          borderRadius: '6px',
          padding: '4px 8px',
          fontSize: '10px',
          fontFamily: 'monospace',
          color: '#0F172A',
          lineHeight: '1.4',
          maxWidth: '160px',
          whiteSpace: 'normal',
          wordBreak: 'keep-all',
          overflowWrap: 'break-word',
          textAlign: 'center',
          boxShadow: '2px 2px 0 #0F172A',
        }}
      >
        {text}
      </div>
      {/* tail */}
      <div
        style={{
          position: 'absolute',
          bottom: '-8px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '8px solid #1E293B',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-5px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: '7px solid #F8FAFC',
        }}
      />
    </div>
  );
}
