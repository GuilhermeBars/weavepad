import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth, signOut } from '../auth';
import { Dashboard } from '../components/dashboard';
export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  return (
    <>
      <header className="app-header">
        <Link href="/" className="brand">
          ▧ <span>weavepad</span>
        </Link>
        <div className="row">
          <span className="muted">{session.user.name}</span>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/login' });
            }}
          >
            <button>Sign out</button>
          </form>
        </div>
      </header>
      <Dashboard name={session.user.name || 'there'} />
    </>
  );
}
