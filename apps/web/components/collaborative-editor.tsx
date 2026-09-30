'use client';
import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import type { Role } from '@weavepad/shared';
import type { Identity } from '../lib/access';
import { useCollabProvider, type CollabResources } from '../hooks/use-collab-provider';
import { ConnectionBadge, PresenceAvatars } from './editor-presence';
import { EditorToolbar } from './editor-toolbar';

export function CollaborativeEditor({
  id,
  user,
  role,
  onConnection,
  onRole,
}: {
  id: string;
  user: Identity;
  role: Role;
  onConnection: (value: boolean) => void;
  onRole: (value: Role) => void;
}) {
  const { resources, status, present } = useCollabProvider(id, user, onRole);
  useEffect(
    () => onConnection(status.connected && status.synced && !status.denied),
    [status, onConnection],
  );
  return (
    <>
      <div className="presence-bar">
        <ConnectionBadge status={status} />
        <PresenceAvatars present={present} />
      </div>
      {resources ? (
        <Editor resources={resources} user={user} editable={role !== 'viewer' && !status.denied} />
      ) : (
        <div className="editor-paper" role="status">
          Opening your document…
        </div>
      )}
    </>
  );
}
function Editor({
  resources,
  user,
  editable,
}: {
  resources: CollabResources;
  user: Identity;
  editable: boolean;
}) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: true,
      editable,
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: resources.doc }),
        CollaborationCaret.configure({ provider: resources.provider, user }),
      ],
      editorProps: {
        attributes: {
          class: 'document-content',
          'aria-label': 'Document content',
          role: 'textbox',
          'aria-multiline': 'true',
        },
      },
    },
    [resources],
  );
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);
  if (!editor) return <div role="status">Loading editor…</div>;
  return (
    <>
      <EditorToolbar editor={editor} editable={editable} />
      <div className="editor-paper">
        <EditorContent editor={editor} />
        {editor.isEmpty && editable && (
          <p className="editor-hint" aria-hidden>
            Start with a thought…
          </p>
        )}
      </div>
      <p className="editor-footnote">
        {editable
          ? 'Your words stay on this device when you go offline.'
          : 'You have view-only access to this document.'}
      </p>
    </>
  );
}
