import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  FolderCode,
  Settings,
  LogOut,
  X,
} from 'lucide-react';
import PinEntry from './components/PinEntry';
import Dashboard from './components/Dashboard';
import ProjectTab from './components/ProjectTab';
import { useLedger } from './hooks/useLedger';
import './index.css';

const SIDECAR_BASE = 'http://127.0.0.1:8100';

interface OpenProject {
  name: string;
  remotePath: string;
  meta: Record<string, any>;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [activeView, setActiveView] = useState<'dashboard' | string>('dashboard');
  const [openProjects, setOpenProjects] = useState<OpenProject[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({});
  const { projects, backups, refresh, loading } = useLedger();

  // Fetch ledgers on auth
  useEffect(() => {
    if (authenticated) {
      refresh();
    }
  }, [authenticated, refresh]);

  const handleAuthenticated = useCallback(() => {
    setAuthenticated(true);
  }, []);

  const openProject = (name: string) => {
    const remotePath = projects[name];
    if (!remotePath) return;

    // Don't re-add if already open
    if (openProjects.some((p) => p.name === name)) {
      setActiveView(name);
      return;
    }

    setOpenProjects((prev) => [...prev, { name, remotePath, meta: {} }]);
    setActiveView(name);
  };

  const closeProject = (name: string) => {
    setOpenProjects((prev) => prev.filter((p) => p.name !== name));
    if (activeView === name) setActiveView('dashboard');
  };

  const handleLock = async () => {
    try {
      await fetch(`${SIDECAR_BASE}/auth/lock`, { method: 'POST' });
    } catch {
      /* ignore */
    }
    setAuthenticated(false);
    setOpenProjects([]);
    setActiveView('dashboard');
  };

  const handleSaveSettings = async () => {
    try {
      await fetch(`${SIDECAR_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: settingsForm }),
      });
      setShowSettings(false);
    } catch {
      /* ignore */
    }
  };

  // ── PIN Gate ───────────────────────────────────────────────────────────
  if (!authenticated) {
    return <PinEntry onAuthenticated={handleAuthenticated} sidecarBase={SIDECAR_BASE} />;
  }

  // ── Main App ───────────────────────────────────────────────────────────
  return (
    <div className="app-layout">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              fontSize: 18,
              fontWeight: 800,
              background: 'var(--accent-gradient)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: -0.5,
            }}
          >
            HCC
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Heavy Control Center
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className="btn-icon"
            onClick={() => {
              setShowSettings(true);
              // Fetch current settings
              fetch(`${SIDECAR_BASE}/settings`)
                .then((r) => r.json())
                .then(setSettingsForm)
                .catch(() => {});
            }}
            id="btn-settings"
          >
            <Settings size={18} />
          </button>
          <button className="btn-icon" onClick={handleLock} id="btn-lock" title="Lock Vault">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* ── Tab Bar ──────────────────────────────────────────────────── */}
      <div className="tab-bar">
        <div
          className={`tab ${activeView === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveView('dashboard')}
          id="tab-dashboard"
        >
          <LayoutDashboard size={14} />
          Dashboard
        </div>
        {openProjects.map((p) => (
          <div
            key={p.name}
            className={`tab ${activeView === p.name ? 'active' : ''}`}
            onClick={() => setActiveView(p.name)}
          >
            <FolderCode size={14} />
            {p.name}
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeProject(p.name);
              }}
            >
              <X size={10} />
            </span>
          </div>
        ))}
      </div>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="app-content">
        {/* ── Sidebar ────────────────────────────────────────────────── */}
        <aside className="app-sidebar">
          <div className="sidebar-section">
            <div className="sidebar-section-title">Projects</div>
            {loading ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 12px' }}>
                Loading...
              </p>
            ) : Object.keys(projects).length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 12px' }}>
                No projects yet
              </p>
            ) : (
              Object.entries(projects).map(([name, path]) => (
                <div
                  key={name}
                  className={`sidebar-item ${activeView === name ? 'active' : ''}`}
                  onClick={() => openProject(name)}
                >
                  <FolderCode size={14} />
                  <div>
                    <div style={{ fontWeight: 500 }}>{name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {(path as string).split('/').slice(-2).join('/')}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Backups</div>
            {Object.keys(backups).length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 12px' }}>
                No backups
              </p>
            ) : (
              Object.entries(backups).map(([name, info]) => (
                <div key={name} className="sidebar-item">
                  <div>
                    <div style={{ fontWeight: 500 }}>{name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {(info as any).timestamps?.length || 0} snapshots
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* ── Main Content ───────────────────────────────────────────── */}
        <main className="app-main">
          {activeView === 'dashboard' && <Dashboard sidecarBase={SIDECAR_BASE} />}
          {openProjects.map((p) =>
            activeView === p.name ? (
              <ProjectTab
                key={p.name}
                projectName={p.name}
                remotePath={p.remotePath}
                projectMeta={p.meta}
                sidecarBase={SIDECAR_BASE}
                onClose={() => closeProject(p.name)}
              />
            ) : null
          )}
        </main>
      </div>

      {/* ── Settings Modal ───────────────────────────────────────────── */}
      {showSettings && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowSettings(false)}
        >
          <div
            className="glass-panel-solid animate-fade-in"
            style={{ width: 500, padding: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>Connection Settings</h2>
              <button className="btn-icon" onClick={() => setShowSettings(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="settings-grid">
              {[
                ['server_host', 'Server Host'],
                ['server_port', 'Server Port'],
                ['ssh_user', 'SSH User'],
                ['ssh_key_path', 'SSH Key Path'],
                ['tailscale_ip', 'Tailscale IP'],
                ['wol_mac', 'WoL MAC Address'],
              ].map(([key, label]) => (
                <div className="settings-field" key={key}>
                  <label className="settings-label">{label}</label>
                  <input
                    className="input input-mono"
                    value={settingsForm[key] || ''}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={() => setShowSettings(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveSettings} id="btn-save-settings">
                Save & Encrypt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
