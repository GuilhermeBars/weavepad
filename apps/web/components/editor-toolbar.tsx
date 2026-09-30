import type { Editor } from '@tiptap/react';
export function EditorToolbar({ editor, editable }: { editor: Editor; editable: boolean }) {
  const actions = [
    {
      label: 'Bold',
      text: 'B',
      active: editor.isActive('bold'),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      text: 'I',
      active: editor.isActive('italic'),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Heading',
      text: 'H2',
      active: editor.isActive('heading', { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'Bullet list',
      text: '• List',
      active: editor.isActive('bulletList'),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      text: '1. List',
      active: editor.isActive('orderedList'),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Code block',
      text: '</>',
      active: editor.isActive('codeBlock'),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: 'Quote',
      text: '❝',
      active: editor.isActive('blockquote'),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
  ];
  return (
    <div className="toolbar" role="toolbar" aria-label="Text formatting">
      {actions.map((action) => (
        <button
          key={action.label}
          aria-label={action.label}
          title={action.label}
          aria-pressed={action.active}
          disabled={!editable}
          onClick={action.run}
        >
          {action.text}
        </button>
      ))}
      <span className="toolbar-divider" />
      <button
        aria-label="Undo"
        disabled={!editable || !editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        ↶
      </button>
      <button
        aria-label="Redo"
        disabled={!editable || !editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        ↷
      </button>
      {!editable && <span className="role">View only</span>}
    </div>
  );
}
