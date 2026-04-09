import { useState, useCallback, useEffect } from 'react';
import { Lock, Delete } from 'lucide-react';

interface PinEntryProps {
  onAuthenticated: () => void;
}

const PIN_LENGTH = 6;
const STORAGE_KEY = 'hcc_pin_hash';

/**
 * Hash a PIN using SHA-256 and return hex string.
 * Runs entirely client-side — no sidecar needed.
 */
async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + '_hcc_salt_v1');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function PinEntry({ onAuthenticated }: PinEntryProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [phase, setPhase] = useState<'enter' | 'confirm'>('enter');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Check if PIN hash exists in localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    setIsFirstRun(!stored);
  }, []);

    const handleKeyPress = useCallback(
      async (digit: string) => {
        if (success) return;
        setError('');

        if (phase === 'enter') {
          const next = pin + digit;
          setPin(next);
          if (next.length === PIN_LENGTH) {
            if (isFirstRun) {
              setPhase('confirm');
              setConfirmPin('');
              setPin(next);
            } else {
              const hash = await hashPin(next);
              const stored = localStorage.getItem(STORAGE_KEY);
              if (hash === stored) {
                setSuccess(true);
                // Asynchronously unlock sidecar
                fetch('http://127.0.0.1:8100/auth/unlock', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ pin: next }),
                }).then(async res => {
                  if (!res.ok) {
                    // Fallback: If server vault was deleted but local browser remembers PIN
                    await fetch('http://127.0.0.1:8100/auth/init', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ pin: next }),
                    });
                  }
                }).catch(console.error);
                setTimeout(onAuthenticated, 400);
              } else {
                setError('Invalid PIN');
                setPin('');
              }
            }
          }
        } else {
          const next = confirmPin + digit;
          setConfirmPin(next);
          if (next.length === PIN_LENGTH) {
            if (next === pin) {
              const hash = await hashPin(next);
              localStorage.setItem(STORAGE_KEY, hash);
              setSuccess(true);
              // Asynchronously init sidecar
              fetch('http://127.0.0.1:8100/auth/init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: next }),
              }).catch(console.error);
              setTimeout(onAuthenticated, 400);
            } else {
              setError('PINs do not match');
              setPhase('enter');
              setPin('');
              setConfirmPin('');
            }
          }
        }
      },
      [pin, confirmPin, phase, isFirstRun, onAuthenticated, success]
    );

  const resetAll = () => {
    setPhase('enter');
    setPin('');
    setConfirmPin('');
    setError('');
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

  return (
    <div className="pin-screen">
      <div className="pin-container animate-fade-in">
        <div className="pin-logo">HCC</div>
        <p className="pin-subtitle">
          {isFirstRun
            ? phase === 'enter'
              ? 'Create your Master PIN'
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
              } ${success ? 'filled' : ''}`}
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
              disabled={success}
              id={`pin-key-${n}`}
            >
              {n}
            </button>
          ))}
          <button
            className="pin-key special"
            onClick={resetAll}
            disabled={success}
            id="pin-key-clear"
          >
            CLR
          </button>
          <button
            className="pin-key"
            onClick={() => handleKeyPress('0')}
            disabled={success}
            id="pin-key-0"
          >
            0
          </button>
          <button
            className="pin-key special"
            onClick={handleBackspace}
            disabled={success}
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
            Your PIN is hashed locally. Connection credentials are encrypted on disk.
          </p>
        )}
      </div>
    </div>
  );
}
