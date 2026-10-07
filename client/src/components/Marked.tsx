import { markTerms } from '@/utils/search';

// Text with the search's words picked out on a yellow ground. Without
// terms it is the plain text.
export function Marked({
  text,
  terms,
  className,
}: {
  text: string;
  terms: string[];
  className?: string;
}) {
  const pieces = markTerms(text, terms);
  return (
    <span className={className}>
      {pieces.map((p, i) =>
        p.hit ? (
          <mark key={i} className="bg-mark text-inherit">
            {p.text}
          </mark>
        ) : (
          p.text
        ),
      )}
    </span>
  );
}
