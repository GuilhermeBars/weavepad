'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Change } from 'diff';
import { api } from '../lib/client';
import { Dialog } from './dialog';
type Snapshot = { id: string; label: string; createdAt: string; createdBy: string };
export function HistoryPanel({
  id,
  editable,
  connected,
  close,
}: {
  id: string;
  editable: boolean;
  connected: boolean;
  close: () => void;
}) {
  const [versions, setVersions] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<Snapshot>();
  const [words, setWords] = useState<Change[]>();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(
    async () => setVersions(await api<Snapshot[]>(`/${id}/snapshots`)),
    [id],
  );
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, [load]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="history-panel" aria-label="Version history">
      <div className="row between">
        <h2>Version history</h2>
        <button aria-label="Close history" onClick={close}>
          ✕
        </button>
      </div>
      <p className="muted">Keep the moments that matter.</p>
      {editable && (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            const label = new FormData(event.currentTarget).get('label');
            void run(async () => {
              await api(`/${id}/snapshots`, 'POST', { label });
              await load();
              setNotice('Version saved.');
            });
          }}
        >
          <label>
            Version name
            <input name="label" placeholder="A good first draft" maxLength={200} required />
          </label>
          <button className="primary" disabled={busy || !connected}>
            Save version
          </button>
          {!connected && <small>Connect to save or restore a version.</small>}
        </form>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <SnapshotList
        versions={versions}
        selectedId={selected?.id}
        busy={busy}
        onSelect={(version) =>
          void run(async () => {
            const diff = await api<{ words: Change[] }>(`/${id}/snapshots/${version.id}/diff`);
            setSelected(version);
            setWords(diff.words);
          })
        }
      />
      {!versions.length && (
        <p className="muted">No versions yet. Save a named version to revisit it later.</p>
      )}
      {selected && words && (
        <section className="diff">
          <h3>{selected.label} → current</h3>
          <p className="muted text-xs">Green: added since this version. Red: removed.</p>
          <DiffView words={words} />
          {editable && (
            <button disabled={busy || !connected} onClick={() => setConfirm(true)}>
              Restore this version
            </button>
          )}
        </section>
      )}
      {confirm && selected && (
        <Dialog title="Restore version?" close={() => setConfirm(false)}>
          <p>
            This replaces the current document with “{selected.label}” for everyone. Save the
            current version first if you want to keep it. Offline edits may still merge when their
            authors reconnect.
          </p>
          <div className="row justify-end mt-6">
            <button onClick={() => setConfirm(false)}>Cancel</button>
            <button
              className="primary"
              disabled={busy || !connected}
              onClick={() =>
                void run(async () => {
                  await api(`/${id}/snapshots/${selected.id}/restore`, 'POST');
                  setConfirm(false);
                  setWords(undefined);
                  setSelected(undefined);
                  setNotice('Version restored for everyone.');
                })
              }
            >
              Restore version
            </button>
          </div>
        </Dialog>
      )}
    </aside>
  );
}

function SnapshotList({
  versions,
  selectedId,
  busy,
  onSelect,
}: {
  versions: Snapshot[];
  selectedId: string | undefined;
  busy: boolean;
  onSelect: (version: Snapshot) => void;
}) {
  return (
    <ul className="version-list">
      {versions.map((version) => (
        <li key={version.id}>
          <button
            disabled={busy}
            aria-pressed={selectedId === version.id}
            onClick={() => onSelect(version)}
          >
            <strong>{version.label}</strong>
            <small>
              {new Date(version.createdAt).toLocaleString()} · {version.createdBy}
            </small>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DiffView({ words }: { words: Change[] }) {
  return (
    <div className="diff-content">
      {words.map((word, i) =>
        word.added ? (
          <ins key={i}>{word.value}</ins>
        ) : word.removed ? (
          <del key={i}>{word.value}</del>
        ) : (
          <span key={i}>{word.value}</span>
        ),
      )}
    </div>
  );
}
