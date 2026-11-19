/** Torre de control: la marca de la web y el icono de la base. */
export function TowerIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5.5 4h13l-2.4 5.2H7.9z" />
      <path d="M9.6 6.6h4.8" />
      <path d="M9.3 9.2 8.4 20.5h7.2l-.9-11.3" />
      <path d="M5 20.5h14" />
      <path d="M12 1.5V4" />
    </svg>
  );
}
