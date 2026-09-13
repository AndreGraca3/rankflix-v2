export function Spinner({ full = false }: { full?: boolean }) {
  return (
    <div className={full ? "spinner-page" : "spinner-wrap"}>
      <span className="spinner" />
    </div>
  );
}
