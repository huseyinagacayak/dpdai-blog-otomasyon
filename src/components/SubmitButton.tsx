'use client';

import { useFormStatus } from 'react-dom';

/**
 * Form gonderim butonu — tiklaninca ANINDA "isleniyor" durumuna gecer
 * (spinner + metin) ve devre disi kalir. Boylece kullanici "bir sey oldu mu"
 * diye tereddut etmez. useFormStatus icinde bulundugu <form>'u dinler; bu
 * yuzden yalnizca bir form icinde kullanilir.
 */
export function SubmitButton({
  children,
  className = 'btn-primary',
  pendingText,
  formAction,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} formAction={formAction} aria-busy={pending}>
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <Spinner />
          {pendingText ?? 'İşleniyor…'}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
