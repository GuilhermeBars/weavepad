'use client';
import { useEffect, useRef } from 'react';
export function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="dialog-content">
        <div className="row between">
          <h2>{title}</h2>
          <button aria-label={`Close ${title}`} onClick={close}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
