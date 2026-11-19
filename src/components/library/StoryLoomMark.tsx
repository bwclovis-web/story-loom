/**
 * Woven bookmark mark for the Story Loom wordmark.
 * Original linework: a pointed bookmark with an over-under braid.
 */
export function StoryLoomMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 32"
      width="24"
      height="32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6.25 2.6h11.5V21.2L12 26.7 6.25 21.2V2.6z" />
      <path d="M8.4 8.1c1.5 1.7 2.5 2.2 3.6 1.2" />
      <path d="M15.6 8.1c-1.5 1.7-2.4 2.5-3.6 1.5" />
      <path d="M8.4 13.2c2.4 2.2 4.8 2.2 7.2 0" />
      <path d="M12 11.4v2.1" />
      <path d="M9.2 16.4c1.3-1.2 2.1-1.5 2.8-.3.7 1.2 1.5.9 2.8-.3" />
      <path d="M8.6 19.2c2.2-1.6 4.6-1.6 6.8 0" />
    </svg>
  );
}
