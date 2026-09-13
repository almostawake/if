import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ConfirmationResult } from 'firebase/auth';
import { useAuthStore } from '@/state/authStore';
import { useUsersStore } from '@/state/usersStore';
import { AuthService } from '@/services/AuthService';
import { formatAuMobile, normalizeAuMobile } from '@common/mobile';

/**
 * The app's front door. There is no public/marketing surface — you land
 * here, sign in, and land on /users. Two steps in one route: enter a
 * mobile, then enter the code texted to it. (A separate /auth/action
 * route, which email-link sign-in needed, has no equivalent — there's no
 * link to land on, so the whole flow stays in this component's state.)
 */
export function SignInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const denied = searchParams.get('denied') === '1';

  const loaded = useAuthStore((s) => s.loaded);
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState('');
  const codeRef = useRef<HTMLInputElement>(null);

  // A signed-in admin has no business on the sign-in screen — send them
  // to /users, the landing page of the app proper.
  useEffect(() => {
    if (loaded && user && isAdmin === true) {
      navigate('/users', { replace: true });
    }
  }, [loaded, user, isAdmin, navigate]);

  useEffect(() => {
    if (confirmation) codeRef.current?.focus();
  }, [confirmation]);

  async function submitMobile(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const e164 = normalizeAuMobile(mobile);
    if (!e164) {
      setError("that's not an australian mobile — like 0412 345 678");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setConfirmation(await AuthService.sendCode(e164));
      setSentTo(e164);
      // Local dev sends no actual SMS — the emulator just records the
      // code. Pre-fill it so signing in locally is one click, not a trip
      // through the emulator logs.
      const dev = await AuthService.devCode(e164);
      if (dev) setCode(dev);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !confirmation) return;
    setBusy(true);
    setError(null);
    try {
      const signedIn = await AuthService.confirmCode(confirmation, code);
      // Best-effort enrichment of the whitelist row with uid +
      // lastSignInAt. Failure shouldn't block the redirect — the user is
      // signed in either way, and the next sign-in will retry. A user who
      // isn't whitelisted fails this write silently and is then bounced
      // by the AppLayout gate, which is the intended outcome.
      try {
        await useUsersStore.getState().recordSignIn(signedIn);
      } catch {
        /* swallow */
      }
      navigate('/users', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setConfirmation(null);
    setCode('');
    setError(null);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      {!confirmation ? (
        <form onSubmit={submitMobile} className="space-y-3">
          {denied && (
            <div className="text-err">
              that number isn't on the admin list. ask an existing admin to add you.
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              id="mobile"
              className="tx-input w-[360px]"
              type="tel"
              autoComplete="tel"
              required
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="0412 345 678"
            />
            <button
              className="tx-btn whitespace-nowrap"
              type="submit"
              disabled={busy || !mobile.trim()}
            >
              {busy ? 'sending…' : 'text me a code'}
            </button>
          </div>
          {error && <div className="text-err">{error}</div>}
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-3">
          <p className="text-fg-muted">we texted a code to {formatAuMobile(sentTo)}.</p>
          <div className="flex items-center gap-2">
            <input
              id="code"
              className="tx-input w-[180px]"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              ref={codeRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
            />
            <button
              className="tx-btn whitespace-nowrap"
              type="submit"
              disabled={busy || !code.trim()}
            >
              {busy ? 'checking…' : 'sign in'}
            </button>
          </div>
          {error && <div className="text-err">{error}</div>}
          <button type="button" className="tx-btn-ghost" onClick={startOver}>
            use a different number
          </button>
        </form>
      )}
    </div>
  );
}
