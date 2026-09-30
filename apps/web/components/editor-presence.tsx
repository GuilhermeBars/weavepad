import { statusLabel, type ConnectionState } from '../lib/status';
import type { PresentPerson } from '../hooks/use-presence';
export function ConnectionBadge({ status }: { status: ConnectionState }) {
  return (
    <span
      role="status"
      className={`connection ${status.connected && status.synced ? 'online' : ''}`}
    >
      <span aria-hidden>●</span> {statusLabel(status)}
    </span>
  );
}
export function PresenceAvatars({ present }: { present: PresentPerson[] }) {
  return (
    <div className="avatars" aria-label="People in this document">
      {present.slice(0, 6).map((person) => (
        <span
          key={person.client}
          className="avatar"
          style={{ backgroundColor: person.color }}
          title={person.name}
          aria-label={person.name}
        >
          {person.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {present.length > 6 && <span>+{present.length - 6}</span>}
    </div>
  );
}
