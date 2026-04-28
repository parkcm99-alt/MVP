import OfficeCanvas from '@/components/office/OfficeCanvas';
import TaskQueue from '@/components/panels/TaskQueue';
import AgentStatus from '@/components/panels/AgentStatus';
import EventLog from '@/components/panels/EventLog';
import CommandCenterPlaceholder from '@/components/command-center/CommandCenterPlaceholder';

export default function Page() {
  return (
    <div className="app-shell">
      {/* title bar */}
      <header className="app-titlebar">
        <h1>⬛ AI AGENT OFFICE SIMULATOR</h1>
        <span className="version">v0.2.0-alpha · VISUAL LAYER · MOCK MODE</span>
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
          <CommandCenterPlaceholder />
        </div>

      </div>
    </div>
  );
}
