import { useState, useCallback, useEffect } from 'react';
import { Lock, Delete } from 'lucide-react';

interface PinEntryProps {
  onAuthenticated: () => void;
  sidecarBase: string;
}

const PIN_LENGTH = 6;

export default function PinEntry({ onAuthenticated, sidecarBase }: PinEntryProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<'enter' | 'confirm'>('enter');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);


  // Check vault status on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${sidecarBase}/auth/status`);
        const data = await res.json();
        setIsFirstRun(!data.initialized);
        if (data.unlocked) {
          onAuthenticated();
        }
      } catch {
        setError('Cannot connect to sidecar');
      } finally {
        setLoading(false);
      }
    })();
  }, [sidecarBase, onAuthenticated]);

  const handleKeyPress = useCallback(
    async (digit: string) => {
      if (success) return;
      setError('');

      if (phase === 'enter') {
        const next = pin + digit;
        setPin(next);
        if (next.length === PIN_LENGTH) {
          if (isFirstRun) {
            // First run: move to confirm phase
            setPhase('confirm');
            setConfirmPin('');
            setPin(next);
          } else {
            // Unlock
            setLoading(true);
            try {
              const res = await fetch(`${sidecarBase}/auth/unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: next }),
              });
              const data = await res.json();
              if (data.success) {
                setSuccess(true);
                setTimeout(onAuthenticated, 500);
              } else {
                setError(data.detail || 'Invalid PIN');
                setPin('');
              }
            } catch {
              setError('Connection error');
              setPin('');
            } finally {
              setLoading(false);
            }
          }
        }
      } else {
        // Confirm phase
        const next = confirmPin + digit;
        setConfirmPin(next);
        if (next.length === PIN_LENGTH) {
          if (next === pin) {
            // Create vault
            setLoading(true);
            try {
              const res = await fetch(`${sidecarBase}/auth/init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: next }),
              });
              const data = await res.json();
              if (data.success) {
                setSuccess(true);
                setTimeout(onAuthenticated, 500);
              } else {
                setError(data.detail || 'Initialization failed');
                resetAll();
              }
            } catch {
              setError('Connection error');
              resetAll();
            } finally {
              setLoading(false);
            }
          } else {
            setError('PINs do not match');
            setPhase('enter');
            setPin('');
            setConfirmPin('');
          }
        }
      }
    },
    [pin, confirmPin, phase, isFirstRun, sidecarBase, onAuthenticated, success]
  );

  const resetAll = () => {
    setPhase('enter');
    setPin('');
    setConfirmPin('');
  };

  const handleBackspace = () => {
    setError('');
    if (phase === 'confirm') {
      setConfirmPin((p) => p.slice(0, -1));
    } else {
      setPin((p) => p.slice(0, -1));
    }
  };

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleKeyPress]);

  const currentPin = phase === 'confirm' ? confirmPin : pin;

  if (loading && isFirstRun === null) {
    return (
      <div className="pin-screen">
        <div className="pin-container animate-fade-in">
          <div className="pin-logo">HCC</div>
          <p className="pin-subtitle" style={{ color: 'var(--text-muted)' }}>
            Connecting...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pin-screen">
      <div className="pin-container animate-fade-in">
        <div className="pin-logo">HCC</div>
        <p className="pin-subtitle">
          {isFirstRun
            ? phase === 'enter'
              ? 'Set your Master PIN'
              : 'Confirm your PIN'
            : 'Enter your PIN'}
        </p>

        {/* PIN Dots */}
        <div className="pin-dots">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={`pin-dot ${i < currentPin.length ? 'filled' : ''} ${
                error ? 'error' : ''
              }`}
            />
          ))}
        </div>

        <p className="pin-error-msg">{error}</p>

        {/* Keypad */}
        <div className="pin-keypad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button
              key={n}
              className="pin-key"
              onClick={() => handleKeyPress(String(n))}
              disabled={loading}
              id={`pin-key-${n}`}
            >
              {n}
            </button>
          ))}
          <button
            className="pin-key special"
            onClick={resetAll}
            disabled={loading}
            id="pin-key-clear"
          >
            CLR
          </button>
          <button
            className="pin-key"
            onClick={() => handleKeyPress('0')}
            disabled={loading}
            id="pin-key-0"
          >
            0
          </button>
          <button
            className="pin-key special"
            onClick={handleBackspace}
            disabled={loading}
            id="pin-key-back"
          >
            <Delete size={20} />
          </button>
        </div>

        {isFirstRun && (
          <p
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              textAlign: 'center',
              maxWidth: '280px',
            }}
          >
            <Lock size={12} style={{ display: 'inline', marginRight: 4 }} />
            Your PIN encrypts all connection credentials locally using AES-256-GCM
          </p>
        )}
      </div>
    </div>
  );
}
