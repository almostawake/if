import { useRef, type InputHTMLAttributes, type Ref } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> };

// The standard text input: bordered, accent border on focus. Every
// <input> attribute passes through (type, inputMode, autoComplete, …).
export function Input({ className = '', ...rest }: InputProps) {
  return (
    <input
      className={`border-border bg-bg focus:border-accent placeholder:text-fg-faint rounded-[3px] border px-2 py-1.5 outline-none ${className}`}
      {...rest}
    />
  );
}

const CLEAR_W = 26;

// A search box: an Input with a small × at its right-hand end while there
// is something in it; Esc clears too. `className` places the box (width,
// flex, margin); the × puts the cursor back in the box.
export function SearchInput({
  value,
  onChange,
  className = '',
  ...rest
}: Omit<InputProps, 'value' | 'onChange' | 'className'> & {
  value: string;
  onChange: (text: string) => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className={`relative inline-flex ${className}`}>
      <Input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="search"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChange('');
        }}
        className="text-small w-full py-1"
        style={{ paddingRight: CLEAR_W }}
        {...rest}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
          aria-label="clear search"
          className="text-fg-faint absolute inset-y-0 right-0 flex items-center justify-center hover:opacity-60"
          style={{ width: CLEAR_W }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
