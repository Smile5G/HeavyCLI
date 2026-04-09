import { useMemo } from 'react';
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Gpu,
  PowerOff,
  Wifi,
  WifiOff,
  Activity,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useWebSocket } from '../hooks/useWebSocket';

interface DashboardProps {
  sidecarBase: string;
  connectionState?: 'connecting' | 'connected' | 'failed';
}

export default function Dashboard({ sidecarBase, connectionState = 'connected' }: DashboardProps) {
  const isOnline = connectionState === 'connected';
  const { stats, connected, history } = useWebSocket(sidecarBase, isOnline);

  const chartData = useMemo(
    () =>
      history.map((s, i) => ({
        idx: i,
        cpu: s.cpu_percent,
        ram: s.ram_percent,
        disk: s.disk_percent,
        gpu: s.gpu?.load_percent ?? 0,
      })),
    [history]
  );

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Dashboard</h2>
        {isOnline && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className={`badge ${connected ? 'badge-success' : 'badge-warning'}`}>
              {connected ? (
                <>
                  <Wifi size={12} /> Telemetry Live
                </>
              ) : (
                <>
                  <WifiOff size={12} /> Telemetry Connecting
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* ── Metric Cards ───────────────────────────────────────────────── */}
      <div className="metric-grid">
        <MetricCard
          icon={<Cpu size={18} />}
          label="CPU"
          value={stats?.cpu_percent ?? 0}
          unit="%"
          color="#6366f1"
        />
        <MetricCard
          icon={<MemoryStick size={18} />}
          label="RAM"
          value={stats?.ram_used_gb ?? 0}
          unit={`/ ${stats?.ram_total_gb ?? 0} GB`}
          percent={stats?.ram_percent ?? 0}
          color="#8b5cf6"
        />
        <MetricCard
          icon={<HardDrive size={18} />}
          label="Disk"
          value={stats?.disk_used_gb ?? 0}
          unit={`/ ${stats?.disk_total_gb ?? 0} GB`}
          percent={stats?.disk_percent ?? 0}
          color="#a78bfa"
        />
        {stats?.gpu && (
          <MetricCard
            icon={<Gpu size={18} />}
            label={stats.gpu.name}
            value={stats.gpu.load_percent}
            unit={`% · ${stats.gpu.temperature}°C`}
            percent={stats.gpu.load_percent}
            color="#c084fc"
          />
        )}
      </div>

      {/* ── Live Chart ─────────────────────────────────────────────────── */}
      <div className="glass-panel chart-container">
        <h3>
          <Activity size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
          System Load (60s)
        </h3>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
            <defs>
              <linearGradient id="gradCpu" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradRam" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="idx" tick={false} axisLine={false} />
            <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{
                background: '#1a1a26',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ display: 'none' }}
            />
            <Area type="monotone" dataKey="cpu" stroke="#6366f1" fill="url(#gradCpu)" strokeWidth={2} name="CPU %" />
            <Area type="monotone" dataKey="ram" stroke="#8b5cf6" fill="url(#gradRam)" strokeWidth={2} name="RAM %" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Quick Actions ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn-danger" id="btn-shutdown" onClick={() => handleShutdown(sidecarBase)}>
          <PowerOff size={16} /> Soft Shutdown
        </button>
      </div>
    </div>
  );
}

/* ── Metric Card Sub-component ─────────────────────────────────────────── */

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  unit: string;
  percent?: number;
  color: string;
}

function MetricCard({ icon, label, value, unit, percent, color }: MetricCardProps) {
  const barPercent = percent ?? value;
  return (
    <div className="glass-panel metric-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color, marginBottom: 4 }}>
        {icon}
        <span className="metric-label" style={{ margin: 0 }}>
          {label}
        </span>
      </div>
      <div className="metric-value">
        {typeof value === 'number' ? value.toFixed(1) : value}
        <span className="metric-unit">{unit}</span>
      </div>
      <div className="metric-bar">
        <div
          className="metric-bar-fill"
          style={{
            width: `${Math.min(barPercent, 100)}%`,
            background: barPercent > 90 ? 'var(--danger)' : `linear-gradient(90deg, ${color}, ${color}aa)`,
          }}
        />
      </div>
    </div>
  );
}

/* ── Action Handlers ───────────────────────────────────────────────────── */

async function handleShutdown(sidecarBase: string) {
  if (!window.confirm('Are you sure you want to shut down the server?')) return;
  try {
    await fetch(`${sidecarBase}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_command: 'execute shutdown -h now' }),
    });
  } catch {
    // TODO: show toast
  }
}
