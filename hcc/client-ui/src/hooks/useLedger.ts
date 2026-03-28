import { useState, useCallback } from 'react';

const SIDECAR_BASE = 'http://127.0.0.1:8100';

export interface Ledgers {
  projects: Record<string, string>;
  backups: Record<string, { root_path: string; timestamps: string[] }>;
}

/**
 * Hook for fetching and mutating server ledgers via the sidecar proxy.
 */
export function useLedger() {
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [backups, setBackups] = useState<Record<string, { root_path: string; timestamps: string[] }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLedger = useCallback(async (type: 'projects' | 'backups') => {
    try {
      const res = await fetch(`${SIDECAR_BASE}/ledger/${type}`);
      if (!res.ok) throw new Error(`Failed to fetch ${type} ledger`);
      const data = await res.json();
      if (type === 'projects') setProjects(data);
      else setBackups(data);
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([fetchLedger('projects'), fetchLedger('backups')]);
    setLoading(false);
  }, [fetchLedger]);

  const addProject = useCallback(async (name: string, path: string) => {
    try {
      const res = await fetch(`${SIDECAR_BASE}/ledger/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ledger_type: 'projects',
          changeset: { action: 'add', key: name, value: path },
        }),
      });
      if (!res.ok) throw new Error('Failed to add project');
      const data = await res.json();
      setProjects(data);
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, []);

  const removeProject = useCallback(async (name: string) => {
    try {
      const res = await fetch(`${SIDECAR_BASE}/ledger/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ledger_type: 'projects',
          changeset: { action: 'remove', key: name },
        }),
      });
      if (!res.ok) throw new Error('Failed to remove project');
      const data = await res.json();
      setProjects(data);
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, []);

  return {
    projects,
    backups,
    loading,
    error,
    refresh,
    addProject,
    removeProject,
    fetchLedger,
  };
}
