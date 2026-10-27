import { redirect } from 'next/navigation';
import { currentProfile } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  redirect((await currentProfile()) ? '/dashboard' : '/login');
}
