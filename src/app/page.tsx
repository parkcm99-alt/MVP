import OfficeCanvas from '@/components/office/OfficeCanvas';
import TaskQueue from '@/components/panels/TaskQueue';
import AgentStatus from '@/components/panels/AgentStatus';
import EventLog from '@/components/panels/EventLog';

export default function Page() {
  return (
    <div className="app-shell">
      {/* title bar */}
      <header className="app-titlebar">
        <h1>⬛ AI AGENT OFFICE SIMULATOR</h1>
        <span className="version">v0.1.0-alpha · VISUAL LAYER · MOCK MODE</span>
      </header>

      {/* main body */}
      <div className="app-body">
        {/* left: office + event log */}
        <div className="office-col">
          <OfficeCanvas />
          <div className="bottom-row">
            <EventLog />
          </div>
        </div>

        {/* right: panels */}
        <div className="side-col">
          <TaskQueue />
          <AgentStatus />
        </div>
      </div>
    </div>
  );
}
