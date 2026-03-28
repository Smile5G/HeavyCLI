import { useState, useEffect, useRef, useCallback } from 'react';

/** Shape of a single stats update from the server. */
export interface SystemStats {
  cpu_percent: number;
  ram_total_gb: number;
  ram_used_gb: number;
  ram_percent: number;
  disk_total_gb: number;
  disk_used_gb: number;
  disk_percent: number;
  gpu: {
    name: string;
    load_percent: number;
    memory_used_mb: number;
    memory_total_mb: number;
    temperature: number;
  } | null;
}

/**
 * Hook to connect to the sidecar's WebSocket for real-time system telemetry.
 */
export function useWebSocket(sidecarBase: string, enabled: boolean = true) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [history, setHistory] = useState<SystemStats[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number>(0);

  const connect = useCallback(() => {
    if (!enabled) return;

    const wsUrl = sidecarBase.replace('http://', 'ws://').replace('https://', 'wss://');
    const ws = new WebSocket(`${wsUrl}/ws/stats`);

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data: SystemStats = JSON.parse(event.data);
        setStats(data);
        setHistory((prev) => {
          const next = [...prev, data];
          return next.length > 60 ? next.slice(-60) : next; // keep 60 data points
        });
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 3s
      reconnectTimerRef.current = window.setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [sidecarBase, enabled]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connect]);

  return { stats, connected, history };
}

/**
 * Hook to connect to the sidecar's WebSocket for process output streaming.
 */
export function useProcessOutput(sidecarBase: string, pid: number | null) {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(true);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (pid === null) return;

    setLines([]);
    setRunning(true);
    setExitCode(null);

    const wsUrl = sidecarBase.replace('http://', 'ws://').replace('https://', 'wss://');
    const ws = new WebSocket(`${wsUrl}/ws/output/${pid}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'output') {
          setLines((prev) => [...prev, data.line]);
        } else if (data.event === 'exit') {
          setRunning(false);
          setExitCode(data.exit_code);
        } else if (data.event === 'error' || data.event === 'not_found') {
          setRunning(false);
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      setRunning(false);
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, [sidecarBase, pid]);

  return { lines, running, exitCode };
}
