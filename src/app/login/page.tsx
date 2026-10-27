import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthForm, AuthShell, AuthTitle } from '@/components/auth-form';
import { currentProfile, LOCALE_COOKIE } from '@/lib/auth';
import { isFirstRun } from '@/lib/db';
import type { Locale } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentProfile()) redirect('/dashboard');

  const setup = await isFirstRun();
  const mode = setup ? 'setup' : ('login' as const);
  const locale: Locale = (await cookies()).get(LOCALE_COOKIE)?.value === 'en' ? 'en' : 'ar';

  return (
    <AuthShell locale={locale} mode={mode}>
      <AuthTitle mode={mode} />
      <AuthForm mode={mode} />
    </AuthShell>
  );
}
