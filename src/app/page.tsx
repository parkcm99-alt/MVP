import OfficeCanvas from '@/components/office/OfficeCanvas';
import ActionBar from '@/components/office/ActionBar';
import EventLog from '@/components/panels/EventLog';
import RightPanel from '@/components/layout/RightPanel';
import ConnectionStatus from '@/components/debug/ConnectionStatus';
import RealtimeSyncClient from '@/components/RealtimeSyncClient';

export default function Page() {
  return (
    <div className="app-shell">
      {/* Realtime subscription — renders nothing, client-side only */}
      <RealtimeSyncClient />

      {/* ── Title bar ─────────────────────────────────────────── */}
      <header className="app-titlebar">
        <h1>⬛ AI AGENT OFFICE SIMULATOR</h1>
        <div className="titlebar-right">
          <ConnectionStatus />
          <span className="version">v0.3.0-alpha</span>
        </div>
      </header>

      {/* ── Top command area: Work Request + Action Buttons ────── */}
      <ActionBar />

      {/* ── Main body: Pixel Office  +  Right Panel ────────────── */}
      <div className="app-body">

        {/* Left: pixel office canvas */}
        <div className="office-col">
          <OfficeCanvas />
        </div>

        {/* Right: tabbed control panel */}
        <RightPanel />

      </div>

      {/* ── Bottom: Event Log (full-width, collapsible) ─────────── */}
      <EventLog />
    </div>
  );
}
