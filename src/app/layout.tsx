import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/figtree';
import '@fontsource-variable/bricolage-grotesque';
import './globals.css';
import { getSettings } from '@/services/settings';

// Everything here reads the database or cookies, so nothing is pre-rendered at build time.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  let name = 'Subdesk';
  try {
    name = (await getSettings()).siteName;
  } catch {
    /* database not reachable yet: fall back to the default name */
  }
  return {
    title: { default: `${name}: Reddit account tasks`, template: `%s · ${name}` },
    description: 'Submit your Reddit profile for review and apply for tasks your account qualifies for.',
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f5f6f8' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
