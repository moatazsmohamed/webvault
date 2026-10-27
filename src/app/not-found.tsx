import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="card card-pad max-w-sm text-center">
        <p className="text-3xl font-semibold">404</p>
        <p className="mt-2 text-sm muted">العنصر ده مش موجود — أو هو تبع حساب تاني.</p>
        <p className="mt-1 text-xs faint">This record does not exist, or it belongs to another account.</p>
        <Link href="/dashboard" className="btn btn-primary mt-5 w-full">
          رجوع للوحة التحكم
        </Link>
      </div>
    </main>
  );
}
