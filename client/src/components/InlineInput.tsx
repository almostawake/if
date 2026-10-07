import { useRef, useState } from 'react';

// A value edited in place: shows the saved value until you type, keeps
// what you typed until the save has come back through the listener, saves
// when you leave it (Enter / Tab / click away), Esc puts it back.
export function InlineInput({
  value,
  onCommit,
  placeholder,
  'aria-label': ariaLabel,
  className = '',
}: {
  value: string;
  onCommit: (v: string) => Promise<void>;
  placeholder?: string;
  'aria-label': string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  const finish = () => {
    const next = cancelled.current || draft === null ? value : draft.trim();
    cancelled.current = false;
    if (next === value) setDraft(null);
    else onCommit(next).finally(() => setDraft(null));
  };

  return (
    <input
      ref={input}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') input.current?.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          input.current?.blur();
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      className={`focus:border-accent focus:bg-bg placeholder:text-fg-faint rounded border border-transparent px-2 py-1 outline-none ${className}`}
    />
  );
}
