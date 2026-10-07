import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useAuthStore } from '@/state/authStore';
import { useUsersStore } from '@/state/usersStore';
import { formatAuMobile } from '@common/mobile';

/**
 * /users — the landing page after sign-in. Add/remove mobile numbers on
 * the `users` collection. Anyone listed here can sign in and edit this
 * list (users manage users — there's no separate admin tier). Each row:
 * the number, ×. The list always keeps at least one number.
 */
export function UsersPage() {
  const user = useAuthStore((s) => s.user);
  const users = useUsersStore((s) => s.users);
  const addUser = useUsersStore((s) => s.add);
  const removeUser = useUsersStore((s) => s.remove);

  const [adding, setAdding] = useState(false);
  const [newMobile, setNewMobile] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function startAdd() {
    setAdding(true);
    setNewMobile('');
    setError(null);
  }

  function cancelAdd() {
    setAdding(false);
    setNewMobile('');
    setError(null);
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await addUser(newMobile, user?.phoneNumber ?? 'unknown');
      cancelAdd();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(mobile: string) {
    setError(null);
    try {
      await removeUser(mobile);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <ul className="space-y-1">
        {users.map((item) => (
          <li key={item.mobile} className="flex items-center gap-3">
            {/* Stored E.164, shown in the 04xx form people recognise. */}
            <span>{formatAuMobile(item.mobile)}</span>
            {users.length > 1 && (
              <button
                type="button"
                className="text-err px-1 text-[24px] leading-[26px] hover:opacity-60"
                onClick={() => remove(item.mobile)}
                aria-label={`delete ${formatAuMobile(item.mobile)}`}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-[26px]">
        {!adding ? (
          <button
            type="button"
            className="text-fg-faint hover:text-fg inline-flex items-center"
            onClick={startAdd}
            aria-label="add a user"
          >
            <span className="text-[24px] leading-[26px]">+</span>
            <span>&nbsp;add a user</span>
          </button>
        ) : (
          <form onSubmit={submitAdd} className="flex flex-wrap items-center gap-2">
            <Input
              ref={inputRef}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              className="w-[200px]"
              placeholder="04xx xxx xxx"
              value={newMobile}
              onChange={(e) => setNewMobile(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelAdd();
              }}
            />
            <Button type="submit" disabled={saving || !newMobile.trim()}>
              {saving ? '…' : 'add'}
            </Button>
            <Button variant="ghost" onClick={cancelAdd}>
              cancel
            </Button>
          </form>
        )}
      </div>

      {error && <div className="text-err mt-3">{error}</div>}
    </>
  );
}
