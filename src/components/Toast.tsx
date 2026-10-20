/** Small floating toast. Parent passes `msg`; renders nothing when null. */
export default function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div key={msg} className="toast-pop" role="status">
      {msg}
    </div>
  );
}
