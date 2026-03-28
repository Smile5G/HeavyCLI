import { useState, useRef, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';

interface CommandBarProps {
  onSubmit: (command: string) => void;
}

const COMMAND_HINTS = [
  'execute <file>',
  'push',
  'pull',
  'pull -?',
  'backup',
  'pushbackup',
  'pullbackup <name> <ts>',
  'get-backup -?',
  'get-backup <name> -?',
  'clone <name>',
  'stop <pid>',
  'status <pid>',
  'del project <name>',
  'del backup <name> <ts>',
  'del backup <name> -a',
];

export default function CommandBar({ onSubmit }: CommandBarProps) {
  const [value, setValue] = useState('');
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [history, setHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setHistory((h) => [trimmed, ...h].slice(0, 50));
    setValue('');
    setHistoryIdx(-1);
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const next = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(next);
        setValue(history[next]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx > 0) {
        const next = historyIdx - 1;
        setHistoryIdx(next);
        setValue(history[next]);
      } else {
        setHistoryIdx(-1);
        setValue('');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (suggestions.length > 0) {
        // Use first suggestion's first word as completion
        const first = suggestions[0];
        const parts = value.split(' ');
        const hintParts = first.split(' ');
        if (parts.length <= hintParts.length) {
          setValue(hintParts.slice(0, parts.length).join(' ') + ' ');
        }
        setShowSuggestions(false);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  // Filter hints
  useEffect(() => {
    if (value.length > 0) {
      const lower = value.toLowerCase();
      const matches = COMMAND_HINTS.filter((h) => h.toLowerCase().startsWith(lower));
      setSuggestions(matches);
      setShowSuggestions(matches.length > 0);
    } else {
      setShowSuggestions(false);
    }
  }, [value]);

  return (
    <div className="command-bar" style={{ position: 'relative' }}>
      <span className="command-prefix">
        <ChevronRight size={14} />
        heavy
      </span>
      <input
        ref={inputRef}
        className="command-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a command..."
        autoComplete="off"
        spellCheck={false}
        id="command-input"
      />
      <button className="btn btn-primary" onClick={handleSubmit} style={{ padding: '8px 16px' }} id="btn-run-command">
        Run
      </button>

      {/* ── Suggestions Dropdown ───────────────────────────────────────── */}
      {showSuggestions && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 80,
            right: 80,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 4,
            zIndex: 50,
            maxHeight: 200,
            overflowY: 'auto',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {suggestions.map((s, i) => (
            <div
              key={i}
              className="sidebar-item"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                padding: '6px 10px',
              }}
              onClick={() => {
                setValue(s.split(' ').filter((p) => !p.startsWith('<')).join(' ') + ' ');
                setShowSuggestions(false);
                inputRef.current?.focus();
              }}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
