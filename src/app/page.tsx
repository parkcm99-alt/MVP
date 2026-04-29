import OfficeCanvas from '@/components/office/OfficeCanvas';
import TaskQueue from '@/components/panels/TaskQueue';
import AgentStatus from '@/components/panels/AgentStatus';
import EventLog from '@/components/panels/EventLog';
import WorkflowGraph from '@/components/command-center/WorkflowGraph';
import ConnectionStatus from '@/components/debug/ConnectionStatus';
import RealtimeSyncClient from '@/components/RealtimeSyncClient';

export default function Page() {
  return (
    <div className="app-shell">
      {/* Realtime subscription — renders nothing, runs client-side only */}
      <RealtimeSyncClient />
      {/* title bar */}
      <header className="app-titlebar">
        <h1>⬛ AI AGENT OFFICE SIMULATOR</h1>
        <div className="titlebar-right">
          <ConnectionStatus />
          <span className="version">v0.2.0-alpha</span>
        </div>
      </header>

      {/* main body */}
      <div className="app-body">

        {/* left: office canvas + event log (EventLog controls own height) */}
        <div className="office-col">
          <OfficeCanvas />
          <EventLog />
        </div>

        {/* right: task queue (flex:1) + agent status (fixed) + workflow (fixed) */}
        <div className="side-col">
          <TaskQueue />
          <AgentStatus />
          <WorkflowGraph />
        </div>

      </div>
    </div>
  );
}
