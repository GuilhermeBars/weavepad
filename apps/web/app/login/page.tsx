import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '../../auth';
import { LoginForm } from '../../components/login-form';
export default async function LoginPage() {
  if (await auth()) redirect('/');
  return (
    <main className="login-shell">
      <section className="login-story">
        <Link className="brand" href="/">
          ▧ <span>weavepad</span>
        </Link>
        <div>
          <p className="eyebrow">BETTER IDEAS, TOGETHER</p>
          <h1>
            A little space.
            <br />A shared possibility.
          </h1>
          <p>
            Write, think, and make something good.
            <br />
            Together in real time. At your own pace offline.
          </p>
        </div>
        <p className="muted">Your words. One shared canvas.</p>
      </section>
      <section className="login-card">
        <p className="eyebrow">YOUR WORKSPACE AWAITS</p>
        <h2>Make yourself at home.</h2>
        <p className="muted">Choose a name and email to start writing.</p>
        <LoginForm github={!!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET)} />
        <p className="fine-print">
          This is a demo workspace. No password or email verification is required; anyone using the
          same email can access that account. Use it for non-sensitive content.
        </p>
      </section>
    </main>
  );
}
