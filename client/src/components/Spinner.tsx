// The wait indicator: a small ring, in the control that will show the
// result. Pair it with a `loading` flag in the store (docs/CLAUDE-REACT.md
// § Waiting). `className` sizes and places it; default 18px.
export function Spinner({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="loading"
      className={`border-border border-t-fg inline-block animate-spin rounded-full border-2 ${className}`}
    />
  );
}
