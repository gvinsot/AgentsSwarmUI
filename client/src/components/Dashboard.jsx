import { useMemo, useState } from 'react';
import AgentTabs from './AgentTabs';
import GlobalControlPanelModal from './GlobalControlPanelModal';

export default function Dashboard({
  user,
  agents,
  templates,
  projects,
  skills,
  mcpServers,
  thinkingMap,
  streamBuffers,
  onLogout,
  onRefresh,
  socket,
  showToast
}) {
  const [globalOpen, setGlobalOpen] = useState(false);
  const plugins = useMemo(() => skills || [], [skills]);

  return (
    <div className="min-h-screen bg-dark-950 text-dark-100">
      <header className="border-b border-dark-800 px-4 py-3 flex items-center justify-between">
        <div className="font-semibold">Agent Swarm</div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded bg-dark-800 hover:bg-dark-700"
            onClick={() => setGlobalOpen(true)}
          >
            Global
          </button>
          <button className="px-3 py-1.5 rounded bg-dark-800 hover:bg-dark-700" onClick={onLogout}>
            Logout ({user?.username})
          </button>
        </div>
      </header>

      <main className="p-4">
        <AgentTabs
          agents={agents}
          templates={templates}
          projects={projects}
          plugins={plugins}
          mcpServers={mcpServers}
          thinkingMap={thinkingMap}
          streamBuffers={streamBuffers}
          onRefresh={onRefresh}
          socket={socket}
          showToast={showToast}
        />
      </main>

      <GlobalControlPanelModal
        isOpen={globalOpen}
        onClose={() => setGlobalOpen(false)}
        plugins={plugins}
        mcpServers={mcpServers}
        onRefresh={onRefresh}
        showToast={showToast}
      />
    </div>
  );
}