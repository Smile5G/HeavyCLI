import { Settings, ShieldAlert, Cpu, TerminalSquare, Edit2, Play } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useProcessOutput } from '../hooks/useWebSocket';

interface AdminTabProps {
  sidecarBase: string;
}

export default function AdminTab({ sidecarBase }: AdminTabProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [showConfig, setShowConfig] = useState(true);

  // Admin Console state
  const [command, setCommand] = useState('');
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [activePid, setActivePid] = useState<number | null>(null);

  const termRef = useRef<HTMLDivElement>(null);
  const { lines, running } = useProcessOutput(sidecarBase, activePid);
  const processedLinesRef = useRef(0);

  // When activePid changes, reset line tracker
  useEffect(() => {
    processedLinesRef.current = 0;
  }, [activePid]);

  // Stream new output lines
  useEffect(() => {
    const unread = lines.slice(processedLinesRef.current);
    if (unread.length > 0) {
      setConsoleOutput((prev) => [...prev, ...unread]);
      processedLinesRef.current = lines.length;
    }
  }, [lines]);

  // Auto-scroll
  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [consoleOutput]);

  useEffect(() => {
    fetch(`${sidecarBase}/settings`)
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        if (data.server_host && data.server_host !== '') {
          setShowConfig(false);
        }
      })
      .catch(() => {});
  }, [sidecarBase]);

  const handleSave = async () => {
    try {
      await fetch(`${sidecarBase}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: settings }),
      });
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        setShowConfig(false);
      }, 1000);
    } catch {
      alert('Failed to save settings');
    }
  };

  const handleRunCommand = async () => {
    if (!command.trim()) return;
    setLoading(true);
    setConsoleOutput((prev) => [...prev, `$ ${command}`]);
    try {
      const res = await fetch(`${sidecarBase}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_command: command }),
      });
      const data = await res.json();
      
      if (data.server_response?.pid) {
        setActivePid(data.server_response.pid);
        setConsoleOutput((prev) => [...prev, `→ Attached to PID ${data.server_response.pid}`]);
      } else if (data.server_response) {
        setConsoleOutput((prev) => [...prev, JSON.stringify(data.server_response, null, 2)]);
      }
      if (data.server_error) {
        setConsoleOutput((prev) => [...prev, `⚠ ${data.server_error}`]);
      }
      setConsoleOutput((prev) => [...prev, `[${data.action}] ${data.description}`]);
    } catch {
      setConsoleOutput((prev) => [...prev, '✗ Sidecar unreachable or error executing command']);
    } finally {
      setLoading(false);
      setCommand('');
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: 20, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ShieldAlert size={24} style={{ color: 'var(--accent-primary)' }} />
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Admin Console</h2>
        </div>
        {!showConfig && (
          <button className="btn btn-ghost" onClick={() => setShowConfig(true)}>
            <Edit2 size={16} /> Edit Vault Config
          </button>
        )}
      </div>

      {showConfig ? (
        <div className="glass-panel" style={{ padding: 24, maxWidth: 600 }}>
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={16} /> Global Vault Configuration
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="settings-field">
              <label className="settings-label">Server Host (IP)</label>
              <input
                className="input input-mono"
                value={settings.server_host || ''}
                onChange={(e) => setSettings({ ...settings, server_host: e.target.value })}
                placeholder="e.g. 192.168.1.100"
              />
            </div>
            <div className="settings-field">
              <label className="settings-label">SSH User</label>
              <input
                className="input input-mono"
                value={settings.ssh_user || ''}
                onChange={(e) => setSettings({ ...settings, ssh_user: e.target.value })}
                placeholder="e.g. root"
              />
            </div>
            <div className="settings-field">
              <label className="settings-label">SSH Password</label>
              <input
                type="password"
                className="input input-mono"
                value={settings.ssh_password || ''}
                onChange={(e) => setSettings({ ...settings, ssh_password: e.target.value })}
                placeholder="Leave blank to drop"
              />
            </div>
            
            <button className="btn btn-primary" onClick={handleSave} style={{ marginTop: 8 }}>
              <Cpu size={16} /> {saved ? 'Saved!' : 'Save & Enter Console'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' }}>
          <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <TerminalSquare size={14} style={{ color: 'var(--accent-secondary)' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Global Root Terminal {(activePid && running) && `(PID: ${activePid})`}</span>
            </div>
            
            <div ref={termRef} style={{ flex: 1, padding: 16, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.7 }}>
              {consoleOutput.length === 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>Connected to Heavy Sidecar. Awaiting global admin commands...</span>
              ) : (
                consoleOutput.map((line, i) => (
                  <div key={i} style={{ color: line.startsWith('$') ? 'var(--accent-tertiary)' : line.startsWith('⚠') || line.startsWith('✗') ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <input
              className="input input-mono"
              style={{ flex: 1, background: 'var(--bg-elevated)' }}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRunCommand()}
              placeholder="e.g. execute sudo apt update"
            />
            <button className="btn btn-primary" onClick={handleRunCommand} disabled={!command || loading}>
              <Play size={16} /> {loading ? 'Running...' : 'Run'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
