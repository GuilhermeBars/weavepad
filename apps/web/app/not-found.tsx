import Link from 'next/link';
export default function NotFound() { return <main className="dashboard"><h1>This page isn’t available.</h1><p>You may need an invitation, or the document may have been deleted.</p><Link href="/">Return to your workspace →</Link></main>; }
