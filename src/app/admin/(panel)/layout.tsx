import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { AdminShell } from '@/components/shells';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: { default: 'Admin', template: '%s · Admin' }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdminPage();
  return <AdminShell admin={admin}>{children}</AdminShell>;
}
