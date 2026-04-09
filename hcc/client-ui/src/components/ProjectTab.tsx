import { useEffect, useRef, useState } from 'react';
import { Clock, FolderCode, X } from 'lucide-react';
import { useProcessOutput } from '../hooks/useWebSocket';
import CommandBar from './CommandBar';

interface ProjectTabProps {
  projectName: string;
  remotePath: string;
  projectMeta: Record<string, any>;
  sidecarBase: string;
  onClose: () => void;
}

export default function ProjectTab({
  projectName,
  remotePath,
  projectMeta,
  sidecarBase,
  onClose,
}: ProjectTabProps) {
  const [activePid, setActivePid] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logHistory, setLogHistory] = useState<string[]>([]);
  const termRef = useRef<HTMLDivElement>(null);
  const { lines, running, exitCode } = useProcessOutput(sidecarBase, activePid);

  // Fetch log history
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${sidecarBase}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw_command: 'logs' }),
        });
        if (res.ok) {
          const data = await res.json();
          setLogHistory(data.server_response || []);
        }
      } catch {
        // server offline
      }
    })();
  }, [sidecarBase]);

  const processedLinesRef = useRef(0);

  // When activePid changes, reset line tracker
  useEffect(() => {
    processedLinesRef.current = 0;
  }, [activePid]);

  // Stream output into terminal-like view
  useEffect(() => {
    const unread = lines.slice(processedLinesRef.current);
    if (unread.length > 0) {
      setLogs((prev) => [...prev, ...unread]);
      processedLinesRef.current = lines.length;
    }
  }, [lines]);

  // Auto-scroll
  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCommand = async (raw: string) => {
    setLogs((prev) => [...prev, `$ ${raw}`]);

    // Intercept "mount <path>"
    const mountMatch = raw.match(/^mount\s+(.+)$/i);
    if (mountMatch) {
      const mountPath = mountMatch[1];
      try {
        // 1. Fetch current settings to avoid overwriting all mounts
        const getRes = await fetch(`${sidecarBase}/settings`);
        const { settings } = await getRes.json();
        
        const updatedMounts = { ...settings.mounts, [projectName]: mountPath };
        
        // 2. Post updated mounts
        const postRes = await fetch(`${sidecarBase}/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: { mounts: updatedMounts } }),
        });

        if (postRes.ok) {
          setLogs((prev) => [...prev, `✓ Mounted local directory: ${mountPath}`]);
        } else {
          setLogs((prev) => [...prev, `✗ Failed to save mount directory.`]);
        }
      } catch {
        setLogs((prev) => [...prev, '✗ Sidecar unreachable']);
      }
      return;
    }

    try {
      const res = await fetch(`${sidecarBase}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_command: raw,
          project_name: projectName,
          project_remote_path: remotePath,
          project_meta: projectMeta,
        }),
      });
      const data = await res.json();

      if (data.server_response?.pid) {
        setActivePid(data.server_response.pid);
        setLogs((prev) => [...prev, `→ PID ${data.server_response.pid}`]);
      } else if (data.server_response) {
        setLogs((prev) => [...prev, JSON.stringify(data.server_response, null, 2)]);
      }
      if (data.server_error) {
        setLogs((prev) => [...prev, `⚠ ${data.server_error}`]);
      }
      if (data.rsync) {
        setLogs((prev) => [
          ...prev,
          data.rsync.success ? '✓ rsync complete' : `✗ rsync failed: ${data.rsync.error}`,
        ]);
      }
      setLogs((prev) => [...prev, `[${data.action}] ${data.description}`]);
    } catch {
      setLogs((prev) => [...prev, '✗ Sidecar unreachable']);
    }
  };

  const envName = projectMeta?.environment
    ? projectMeta.environment.split('/').pop()
    : 'system';

  return (
    <div
      className="animate-fade-in"
      style={{ display: 'flex', height: '100%', gap: 0 }}
    >
      {/* ── Main Terminal Area ─────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FolderCode size={16} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontWeight: 600 }}>{projectName}</span>
            <span className="env-badge">
              <span className="env-dot" />
              {envName}
            </span>
            {activePid && (
              <span className={`badge ${running ? 'badge-success' : 'badge-info'}`}>
                PID {activePid} {running ? '● running' : `exit ${exitCode}`}
              </span>
            )}
          </div>
          <button className="btn-icon" onClick={onClose} id="btn-close-tab">
            <X size={16} />
          </button>
        </div>

        {/* Terminal Body */}
        <div className="terminal-container" style={{ flex: 1, borderRadius: 0, border: 'none' }}>
          <div
            ref={termRef}
            className="terminal-body"
            style={{
              height: '100%',
              overflowY: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              lineHeight: 1.7,
              padding: 16,
              color: 'var(--text-secondary)',
            }}
          >
            {logs.length === 0 ? (
              <span style={{ color: 'var(--text-muted)' }}>
                Ready. Type a command below...
              </span>
            ) : (
              logs.map((line, i) => (
                <div
                  key={i}
                  style={{
                    color: line.startsWith('$')
                      ? 'var(--accent-tertiary)'
                      : line.startsWith('✗') || line.startsWith('⚠')
                      ? 'var(--danger)'
                      : line.startsWith('✓') || line.startsWith('→')
                      ? 'var(--success)'
                      : 'var(--text-secondary)',
                  }}
                >
                  {line}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Command Bar */}
        <CommandBar onSubmit={handleCommand} />
      </div>

      {/* ── History Sidebar ────────────────────────────────────────────── */}
      <div
        style={{
          width: 200,
          minWidth: 200,
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            <Clock size={10} style={{ display: 'inline', marginRight: 4 }} />
            History
          </div>
          {logHistory.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 12px' }}>
              No logs yet
            </p>
          ) : (
            logHistory.map((log, i) => (
              <div key={i} className="sidebar-item" style={{ fontSize: 11 }}>
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
