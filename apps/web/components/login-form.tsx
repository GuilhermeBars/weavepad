'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
export function LoginForm({ github }: { github: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          const data = new FormData(event.currentTarget);
          try {
            const result = await signIn('credentials', {
              name: data.get('name'),
              email: data.get('email'),
              redirect: false,
            });
            if (result?.error)
              throw new Error('Unable to sign in. Check your name and email and try again.');
            window.location.assign('/');
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <label>
          Display name
          <input
            name="name"
            autoComplete="name"
            placeholder="Alex Morgan"
            maxLength={80}
            required
          />
        </label>
        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="alex@example.com"
            maxLength={254}
            required
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Enter workspace →'}
        </button>
      </form>
      {github && (
        <button className="github" onClick={() => void signIn('github', { redirectTo: '/' })}>
          Continue with GitHub
        </button>
      )}
    </>
  );
}
