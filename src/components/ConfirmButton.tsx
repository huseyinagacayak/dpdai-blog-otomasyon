'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Iki asamali onay butonu. Ilk tik "silahlandirir" ve sayi/maliyet uyarisini
 * gosterir; ancak "Onayla" ile form gonderilir. Ucretli toplu islerin (toplu
 * ceviri gibi) tek tikla yuzlerce is baslatmasini onler.
 *
 * Bir <form action=...> icinde kullanilir.
 */
export function ConfirmButton({
  children,
  confirmText,
  className = 'btn-primary',
}: {
  children: React.ReactNode;
  confirmText: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const { pending } = useFormStatus();

  if (pending) {
    return (
      <button type="submit" className={className} disabled aria-busy>
        İşleniyor…
      </button>
    );
  }

  if (!armed) {
    return (
      <button type="button" className={className} onClick={() => setArmed(true)}>
        {children}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm" style={{ color: 'var(--warn)' }}>
        {confirmText}
      </span>
      <button type="submit" className="btn-primary btn-sm">
        Onayla, başlat
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setArmed(false)}>
        Vazgeç
      </button>
    </span>
  );
}
