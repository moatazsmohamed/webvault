import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthShell, AuthTitle } from '@/components/auth-form';
import { ResetForm } from '@/components/reset-form';
import { currentProfile, LOCALE_COOKIE } from '@/lib/auth';
import { isFirstRun } from '@/lib/db';
import { mailEnabled } from '@/lib/mail';
import type { Locale } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage() {
  if (await currentProfile()) redirect('/dashboard');
  // Nothing to recover before the owner account exists, and nothing to recover
  // without a working transport — both cases belong on /login.
  if ((await isFirstRun()) || !mailEnabled()) redirect('/login');

  const locale: Locale = (await cookies()).get(LOCALE_COOKIE)?.value === 'en' ? 'en' : 'ar';

  return (
    <AuthShell locale={locale} mode="reset">
      <AuthTitle mode="reset" />
      <ResetForm initialUsername="" />
    </AuthShell>
  );
}
