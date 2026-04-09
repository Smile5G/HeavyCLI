import { useState, useEffect, useRef } from 'react';
import { TerminalSquare, Play } from 'lucide-react';
import { useLedger } from '../hooks/useLedger';

interface NewProjectTabProps {
  onProjectCreated: (name: string) => void;
  sidecarBase: string;
}

export default function NewProjectTab({ onProjectCreated, sidecarBase }: NewProjectTabProps) {
  const { fetchLedger, projects, backups } = useLedger();

  // Command prompt state
  const [command, setCommand] = useState('');
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);

  const [heavyDir, setHeavyDir] = useState('/heavy');

  useEffect(() => {
    // Initial load: Fetch and display ledger projects and backups
    setConsoleOutput(['Heavy Shell Initialized.', 'Fetching remote context...']);
    
    // Fetch heavy_dir info
    fetch(`${sidecarBase}/info`)
      .then(res => res.json())
      .then(data => {
        if (data.heavy_dir) setHeavyDir(data.heavy_dir);
      })
      .catch(() => console.warn('Failed to fetch heavy_dir context'));

    Promise.all([fetchLedger('projects'), fetchLedger('backups')])
      .then(([projects, backups]) => {
        let lines = [''];
        lines.push('--- [ Active Projects ] ---');
        if (projects && Object.keys(projects).length > 0) {
          Object.entries(projects).forEach(([name, path]) => {
            lines.push(`  ${name.padEnd(16)} -> ${path}`);
          });
        } else {
          lines.push('  None');
        }

        lines.push('');
        lines.push('--- [ Registered Backups ] ---');
        if (backups && Object.keys(backups).length > 0) {
          Object.entries(backups).forEach(([name, meta]: any) => {
            lines.push(`  ${name.padEnd(16)} -> ${meta.root_path} (Snapshots: ${meta.timestamps?.length || 0})`);
          });
        } else {
          lines.push('  None');
        }
        lines.push('');
        lines.push('Usage:');
        lines.push("  create project <name> [-p /remote/path]");
        lines.push("  create backup <name> [-p /remote/path]");
        
        setConsoleOutput((prev) => [...prev, ...lines]);
      })
      .catch(() => setConsoleOutput((prev) => [...prev, '✗ Failed to fetch ledger']));
  }, [fetchLedger]);

  // Auto-scroll
  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [consoleOutput]);

  const handleCommand = async () => {
    if (!command.trim()) return;
    setLoading(true);
    setConsoleOutput((prev) => [...prev, `$ ${command}`]);
    const raw = command.trim();
    setCommand('');

    // Parse commands: create project <name> [-p path]
    const createProjectMatch = raw.match(/^create\s+project\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))(?:\s+-p\s+(?:"([^"]+)"|'([^']+)'|(\S+)))?$/i);
    const createBackupMatch = raw.match(/^create\s+backup\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))(?:\s+-p\s+(?:"([^"]+)"|'([^']+)'|(\S+)))?$/i);

    try {
      if (createProjectMatch) {
        const name = createProjectMatch[1] || createProjectMatch[2] || createProjectMatch[3];
        const path = createProjectMatch[4] || createProjectMatch[5] || createProjectMatch[6] || `${heavyDir}/projects/${name}`;
        
        if (projects[name]) {
          setConsoleOutput((prev) => [...prev, `✓ Project '${name}' already exists. Opening...`]);
          setTimeout(() => onProjectCreated(name), 500);
          return;
        }

        // 1. Physically create the directory on the server
        const mkdirRes = await fetch(`${sidecarBase}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw_command: `mkdir -p ${path}` }),
        });
        
        if (!mkdirRes.ok) {
           setConsoleOutput((prev) => [...prev, `✗ Directory creation failed on server.`]);
           return;
        }

        // 2. Ensure Ledger updates correctly
        const res = await fetch(`${sidecarBase}/ledger/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ledger_type: 'projects',
            changeset: { action: 'add', key: name, value: path },
          }),
        });
        
        if (res.ok) {
          setConsoleOutput((prev) => [...prev, `✓ Created directory and project ledger entry: ${name}`]);
          setTimeout(() => onProjectCreated(name), 500); // trigger tab open
        } else {
          setConsoleOutput((prev) => [...prev, `✗ Server refused project creation (Ledger locked or offline)`]);
        }
      } else if (createBackupMatch) {
         const name = createBackupMatch[1] || createBackupMatch[2] || createBackupMatch[3];
         const path = createBackupMatch[4] || createBackupMatch[5] || createBackupMatch[6] || `${heavyDir}/backups/${name}`;

         if (backups[name]) {
            setConsoleOutput((prev) => [...prev, `✓ Backup '${name}' already exists.`]);
            return;
         }

         // 1. Physically create the directory
         await fetch(`${sidecarBase}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_command: `mkdir -p ${path}` }),
         });

         // 2. Update ledger
         const res = await fetch(`${sidecarBase}/ledger/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ledger_type: 'backups',
              changeset: { action: 'add', key: name, value: { root_path: path, timestamps: [] } },
            }),
         });
         if (res.ok) setConsoleOutput((prev) => [...prev, `✓ Created directory and backup ledger: ${name}`]);
         else setConsoleOutput((prev) => [...prev, `✗ Backup creation failed`]);
      } else {
        // Fallback to proxy execution (OS level commands)
        const res = await fetch(`${sidecarBase}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw_command: raw }),
        });
        const data = await res.json();
        
        if (data.server_response && !data.server_response.pid) {
          setConsoleOutput((prev) => [...prev, JSON.stringify(data.server_response, null, 2)]);
        }
        if (data.server_error) setConsoleOutput((prev) => [...prev, `⚠ ${data.server_error}`]);
        setConsoleOutput((prev) => [...prev, `[${data.action}] ${data.description}`]);
      }
    } catch {
      setConsoleOutput((prev) => [...prev, '✗ Command execution failed']);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: 20, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <TerminalSquare size={24} style={{ color: 'var(--accent-secondary)' }} />
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Heavy Shell</h2>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden', maxWidth: 800 }}>
        <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Interpreter Console</span>
          </div>
          
          <div ref={termRef} style={{ flex: 1, padding: 16, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.7 }}>
            {consoleOutput.map((line, i) => (
              <div key={i} style={{ color: line.startsWith('$') ? 'var(--accent-tertiary)' : line.startsWith('⚠') || line.startsWith('✗') ? 'var(--danger)' : 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                {line}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <input
            className="input input-mono"
            style={{ flex: 1, background: 'var(--bg-elevated)' }}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCommand()}
            placeholder="e.g. create project trading-bot -p /projects/bot"
          />
          <button className="btn btn-primary" onClick={handleCommand} disabled={!command || loading}>
            <Play size={16} /> {loading ? 'Running...' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  );
}
