import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/state/authStore';
import { useUsersStore } from '@/state/usersStore';
import { Page } from '@/components/Page';
import { formatAuMobile } from '@common/mobile';

/**
 * /users — the landing page after sign-in. Add/remove mobile numbers on
 * the `users` collection. Anyone listed here can sign in and edit this
 * list (users manage users — there's no separate admin tier).
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
    <Page title="users" description="these users can sign in and manage this list.">
      <ul className="space-y-1">
        {users.map((item) => (
          <li key={item.mobile} className="group flex items-center gap-2">
            {/* Stored E.164, shown in the 04xx form people recognise. */}
            <span>{formatAuMobile(item.mobile)}</span>
            {users.length > 1 && (
              /*
                Two layered hover states. Row-hover (`group`) reveals the ×
                button; button-hover (`group/del`) additionally reveals the
                "delete" label. Mirrors the `+ add a user` pattern below,
                just in red.
              */
              <button
                type="button"
                className="group/del text-err inline-flex items-center gap-2 opacity-0 group-hover:opacity-100"
                onClick={() => remove(item.mobile)}
                aria-label={`delete ${formatAuMobile(item.mobile)}`}
              >
                <span className="text-[24px] leading-none">×</span>
                <span className="opacity-0 transition-opacity group-hover/del:opacity-100">
                  delete
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-[1.45em]">
        {!adding ? (
          <button
            type="button"
            className="group text-fg-faint hover:text-fg inline-flex items-center gap-2"
            onClick={startAdd}
            aria-label="add a user"
          >
            <span className="text-[24px] leading-none">+</span>
            <span className="opacity-0 transition-opacity group-hover:opacity-100">add a user</span>
          </button>
        ) : (
          <form onSubmit={submitAdd} className="flex items-center gap-2">
            <input
              className="tx-input w-72"
              type="tel"
              required
              ref={inputRef}
              placeholder="0412 345 678"
              value={newMobile}
              onChange={(e) => setNewMobile(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelAdd();
              }}
            />
            <button className="tx-btn" type="submit" disabled={saving || !newMobile.trim()}>
              {saving ? '…' : 'add'}
            </button>
            <button className="tx-btn-ghost" type="button" onClick={cancelAdd}>
              cancel
            </button>
          </form>
        )}
      </div>

      {error && <div className="text-err mt-3">{error}</div>}
    </Page>
  );
}
