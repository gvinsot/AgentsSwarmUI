import { useState, useEffect } from 'react';
import { Save, Shield, Globe, HardDrive, Terminal, User, FolderLock } from 'lucide-react';
import { api } from '../../api';

const DEFAULT_PERMISSIONS = {
  linuxUser: {
    runAsRoot: false,
    customUser: '',
  },
  network: {
    internetAccess: true,
    allowedDomains: [],
  },
  filesystem: {
    readAccess: true,
    writeAccess: true,
    restrictedPaths: [],
  },
  execution: {
    shellAccess: true,
    dangerousSkipPermissions: true,
  },
};

function ToggleSwitch({ enabled, onChange, disabled = false }) {
  return (
    <button
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={`relative w-10 h-5 rounded-full transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${enabled ? 'bg-indigo-500' : 'bg-dark-600'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${enabled ? 'translate-x-5' : ''}`} />
    </button>
  );
}

function PermissionCard({ icon: Icon, title, description, children }) {
  return (
    <div className="p-4 bg-dark-800/50 rounded-lg border border-dark-700/50">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-indigo-400" />
        <h4 className="text-sm font-medium text-dark-200">{title}</h4>
      </div>
      {description && (
        <p className="text-[11px] text-dark-500 mb-3">{description}</p>
      )}
      <div className="space-y-3">
        {children}
      </div>
    </div>
  );
}

function PermissionRow({ label, description, children }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <span className="text-sm text-dark-300">{label}</span>
        {description && <p className="text-[11px] text-dark-500 mt-0.5">{description}</p>}
      </div>
      <div className="flex-shrink-0">
        {children}
      </div>
    </div>
  );
}

function TagInput({ tags, onChange, placeholder }) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const val = input.trim();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
    }
    setInput('');
  };

  const removeTag = (idx) => {
    onChange(tags.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <div className="flex gap-1.5 flex-wrap mb-2">
        {tags.map((tag, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-dark-700 text-dark-300 text-xs rounded-md">
            {tag}
            <button onClick={() => removeTag(i)} className="text-dark-500 hover:text-red-400 ml-0.5">&times;</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
          placeholder={placeholder}
          className="flex-1 px-2 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-xs text-dark-200 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={addTag}
          disabled={!input.trim()}
          className="px-2.5 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 text-xs rounded-lg disabled:opacity-40 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default function PermissionsTab({ agent, onRefresh }) {
  const [perms, setPerms] = useState(() => ({
    ...DEFAULT_PERMISSIONS,
    ...agent.permissions,
    linuxUser: { ...DEFAULT_PERMISSIONS.linuxUser, ...agent.permissions?.linuxUser },
    network: { ...DEFAULT_PERMISSIONS.network, ...agent.permissions?.network },
    filesystem: { ...DEFAULT_PERMISSIONS.filesystem, ...agent.permissions?.filesystem },
    execution: { ...DEFAULT_PERMISSIONS.execution, ...agent.permissions?.execution },
  }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setPerms({
      ...DEFAULT_PERMISSIONS,
      ...agent.permissions,
      linuxUser: { ...DEFAULT_PERMISSIONS.linuxUser, ...agent.permissions?.linuxUser },
      network: { ...DEFAULT_PERMISSIONS.network, ...agent.permissions?.network },
      filesystem: { ...DEFAULT_PERMISSIONS.filesystem, ...agent.permissions?.filesystem },
      execution: { ...DEFAULT_PERMISSIONS.execution, ...agent.permissions?.execution },
    });
    setHasChanges(false);
    setSaved(false);
  }, [agent.id]);

  const update = (section, key, value) => {
    setPerms(prev => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
    setHasChanges(true);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateAgent(agent.id, { permissions: perms });
      setSaved(true);
      setHasChanges(false);
      setTimeout(() => setSaved(false), 2000);
      onRefresh();
    } catch (err) {
      console.error('Failed to save permissions:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-indigo-400" />
          <h3 className="text-sm font-semibold text-dark-100">Permissions & Security</h3>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            saved
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : hasChanges
                ? 'bg-indigo-500 hover:bg-indigo-600 text-white'
                : 'bg-dark-700 text-dark-500 cursor-not-allowed'
          }`}
        >
          {saving ? (
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : saved ? (
            <><span>&#10003;</span> Saved</>
          ) : (
            <><Save className="w-3.5 h-3.5" /> Save</>
          )}
        </button>
      </div>

      {/* Linux User */}
      <PermissionCard
        icon={User}
        title="Linux User"
        description="Controls the user identity inside the agent's container. Running as a non-root user limits the agent's ability to modify system files."
      >
        <PermissionRow
          label="Run as root"
          description="Allows the agent to execute commands with root privileges"
        >
          <ToggleSwitch
            enabled={perms.linuxUser.runAsRoot}
            onChange={(v) => update('linuxUser', 'runAsRoot', v)}
          />
        </PermissionRow>
        <div>
          <label className="block text-xs text-dark-400 mb-1">Custom user</label>
          <input
            type="text"
            value={perms.linuxUser.customUser}
            onChange={(e) => update('linuxUser', 'customUser', e.target.value)}
            placeholder="Leave empty for default (agent user)"
            className="w-full px-2.5 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-xs text-dark-200 focus:outline-none focus:border-indigo-500"
          />
          <p className="text-[10px] text-dark-500 mt-1">Override the Linux user identity (e.g., "node", "www-data")</p>
        </div>
      </PermissionCard>

      {/* Network Access */}
      <PermissionCard
        icon={Globe}
        title="Network Access"
        description="Controls the agent's ability to make outbound network connections. Disabling internet access prevents API calls, package installs, and git operations to remote repos."
      >
        <PermissionRow
          label="Internet access"
          description="Allow outbound network connections (HTTP, HTTPS, SSH, etc.)"
        >
          <ToggleSwitch
            enabled={perms.network.internetAccess}
            onChange={(v) => update('network', 'internetAccess', v)}
          />
        </PermissionRow>
        {!perms.network.internetAccess && (
          <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <p className="text-[11px] text-amber-400">With internet disabled, the agent cannot: install packages, push/pull from git remotes, call external APIs, or access MCP servers over HTTP.</p>
          </div>
        )}
        {perms.network.internetAccess && (
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Allowed domains (empty = all)</label>
            <TagInput
              tags={perms.network.allowedDomains}
              onChange={(v) => update('network', 'allowedDomains', v)}
              placeholder="e.g. github.com, api.anthropic.com"
            />
            <p className="text-[10px] text-dark-500 mt-1">Restrict outbound connections to specific domains. Leave empty to allow all.</p>
          </div>
        )}
      </PermissionCard>

      {/* Filesystem Access */}
      <PermissionCard
        icon={HardDrive}
        title="Filesystem Access"
        description="Controls read and write access to the filesystem. Restricting paths limits which directories the agent can operate on."
      >
        <PermissionRow
          label="Read access"
          description="Allow the agent to read files from the filesystem"
        >
          <ToggleSwitch
            enabled={perms.filesystem.readAccess}
            onChange={(v) => update('filesystem', 'readAccess', v)}
          />
        </PermissionRow>
        <PermissionRow
          label="Write access"
          description="Allow the agent to create and modify files"
        >
          <ToggleSwitch
            enabled={perms.filesystem.writeAccess}
            onChange={(v) => update('filesystem', 'writeAccess', v)}
          />
        </PermissionRow>
        <div>
          <label className="block text-xs text-dark-400 mb-1.5">
            <FolderLock className="w-3 h-3 inline mr-1" />
            Restricted paths
          </label>
          <TagInput
            tags={perms.filesystem.restrictedPaths}
            onChange={(v) => update('filesystem', 'restrictedPaths', v)}
            placeholder="e.g. /etc, /var/log, ~/.ssh"
          />
          <p className="text-[10px] text-dark-500 mt-1">Paths the agent is not allowed to access. Applied on top of read/write permissions.</p>
        </div>
      </PermissionCard>

      {/* Execution */}
      <PermissionCard
        icon={Terminal}
        title="Execution"
        description="Controls the agent's ability to execute commands and bypass permission checks."
      >
        <PermissionRow
          label="Shell access"
          description="Allow the agent to execute shell commands (bash, sh)"
        >
          <ToggleSwitch
            enabled={perms.execution.shellAccess}
            onChange={(v) => update('execution', 'shellAccess', v)}
          />
        </PermissionRow>
        <PermissionRow
          label="Skip permission prompts"
          description="Run Claude Code with --dangerously-skip-permissions (required for autonomous mode)"
        >
          <ToggleSwitch
            enabled={perms.execution.dangerousSkipPermissions}
            onChange={(v) => update('execution', 'dangerousSkipPermissions', v)}
          />
        </PermissionRow>
        {!perms.execution.dangerousSkipPermissions && (
          <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <p className="text-[11px] text-amber-400">Without --dangerously-skip-permissions, Claude Code will prompt for approval on each tool call, which blocks autonomous execution. Only disable this for interactive/supervised agents.</p>
          </div>
        )}
      </PermissionCard>

      {/* Summary */}
      <div className="p-3 bg-dark-700/30 rounded-lg border border-dark-600/30">
        <h4 className="text-xs font-medium text-dark-400 mb-2">Active Configuration Summary</h4>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${perms.linuxUser.runAsRoot ? 'bg-red-500' : 'bg-emerald-500'}`} />
            <span className="text-dark-400">User: {perms.linuxUser.runAsRoot ? 'root' : perms.linuxUser.customUser || 'agent (default)'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${perms.network.internetAccess ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-dark-400">
              Internet: {perms.network.internetAccess
                ? (perms.network.allowedDomains.length > 0 ? `${perms.network.allowedDomains.length} domains` : 'unrestricted')
                : 'disabled'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${perms.filesystem.readAccess && perms.filesystem.writeAccess ? 'bg-emerald-500' : perms.filesystem.readAccess ? 'bg-amber-500' : 'bg-red-500'}`} />
            <span className="text-dark-400">
              Filesystem: {perms.filesystem.readAccess && perms.filesystem.writeAccess ? 'read/write' : perms.filesystem.readAccess ? 'read-only' : 'no access'}
              {perms.filesystem.restrictedPaths.length > 0 ? ` (${perms.filesystem.restrictedPaths.length} restricted)` : ''}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${perms.execution.shellAccess ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-dark-400">Shell: {perms.execution.shellAccess ? 'enabled' : 'disabled'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
