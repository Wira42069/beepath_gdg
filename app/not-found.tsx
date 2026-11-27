import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="state">
      <h1>Page not found</h1>
      <p><Link href="/">Back to all roles</Link></p>
    </div>
  );
}
