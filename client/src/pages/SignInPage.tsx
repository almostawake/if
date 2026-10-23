import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ConfirmationResult } from 'firebase/auth';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useAuthStore } from '@/state/authStore';
import { useUsersStore } from '@/state/usersStore';
import { AuthService } from '@/services/AuthService';
import { formatAuMobile, normalizeAuMobile } from '@common/mobile';

/**
 * The app's front door. There is no public/marketing surface — you land
 * here, sign in, and land on /users. Two steps in one route: enter a
 * mobile, then enter the code texted to it. "start again" abandons an
 * in-flight code and returns to the number field. No header: the sign-in
 * screen has no chrome at all.
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
      setError('australian mobiles only — 04xx xxx xxx or +61 4xx xxx xxx');
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

  function startAgain() {
    setConfirmation(null);
    setCode('');
    setError(null);
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-[520px] flex-col items-start gap-3">
        {!confirmation ? (
          <form onSubmit={submitMobile} className="contents">
            <div className="section-label">sign in with your mobile</div>
            <div className="flex w-full items-center gap-2">
              <Input
                id="mobile"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                className="w-full max-w-[300px]"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="04xx xxx xxx"
              />
              <Button type="submit" disabled={busy || !mobile.trim()}>
                {busy ? 'sending…' : 'send code'}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitCode} className="contents">
            <div className="section-label">enter the code</div>
            <div className="text-small text-fg-faint">sent by sms to {formatAuMobile(sentTo)}</div>
            <div className="flex w-full items-center gap-2">
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                ref={codeRef}
                className="w-full max-w-[300px]"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
              <Button type="submit" disabled={busy || !code.trim()}>
                {busy ? '…' : 'sign in'}
              </Button>
            </div>
            <button type="button" className="text-small text-accent" onClick={startAgain}>
              start again
            </button>
          </form>
        )}
        {denied && (
          <div className="text-err">
            that number isn't on the list. ask an existing user to add you.
          </div>
        )}
        {error && <div className="text-err">{error}</div>}
      </div>
    </div>
  );
}
