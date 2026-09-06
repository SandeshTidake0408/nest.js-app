import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Webhook operations' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
