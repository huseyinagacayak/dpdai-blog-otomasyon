import type { ApiCredential, CredentialKind } from '@prisma/client';
import { IconCheck, IconPlus, IconRefresh, IconTrash } from '@/components/icons';
import { Alert, Panel, fmtDate, fmtMoney } from '@/components/ui';
import {
  addCredential,
  deleteCredential,
  moveCredential,
  resetCredentialHealth,
  testAllCredentials,
  testCredential,
  updateCredential,
} from '@/lib/actions/credentials';
import { mask } from '@/lib/crypto';
import type { Preset } from '@/lib/providers/presets';

const HEALTH: Record<string, { label: string; cls: string }> = {
  OK: { label: 'çalışıyor', cls: 'pill-ok' },
  COOLDOWN: { label: 'bekliyor', cls: 'pill-warn' },
  BROKEN: { label: 'arızalı', cls: 'pill-err' },
};

function Row({
  c,
  index,
  total,
  presets,
}: {
  c: ApiCredential;
  index: number;
  total: number;
  presets: Preset[];
}) {
  const kaydet = updateCredential.bind(null, c.id);
  const sil = deleteCredential.bind(null, c.id);
  const test = testCredential.bind(null, c.id);
  const yukari = moveCredential.bind(null, c.id, 'up');
  const asagi = moveCredential.bind(null, c.id, 'down');
  const sifirla = resetCredentialHealth.bind(null, c.id);

  const health = HEALTH[c.health] ?? HEALTH.OK;
  const preset = presets.find((p) => p.provider === c.provider);
  const bekliyor = c.cooldownUntil && c.cooldownUntil > new Date();

  return (
    <details
      className="rounded-lg"
      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)' }}
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5">
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold tabular-nums"
          style={{ background: 'var(--surface-3)', color: 'var(--ink-3)' }}
        >
          {index + 1}
        </span>

        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium">{c.label}</span>
          <span className="ml-2 text-xs" style={{ color: 'var(--ink-3)' }}>
            {c.model || c.provider}
          </span>
        </span>

        {c.free && <span className="pill-accent">ücretsiz</span>}
        {c.kind === 'TEXT' && c.vision && <span className="pill-neutral">görsel denetimi</span>}
        {!c.enabled ? (
          <span className="pill-neutral">kapalı</span>
        ) : (
          <span className={health.cls}>
            <i className="pill-dot" />
            {health.label}
          </span>
        )}
      </summary>

      <div className="px-3 pt-1 pb-3">
        {c.lastError && (
          <p className="mb-3 text-xs" style={{ color: 'var(--err)' }}>
            {c.lastError}
            {bekliyor && (
              <span style={{ color: 'var(--ink-3)' }}>
                {' '}
                · {fmtDate(c.cooldownUntil)} sonrasında tekrar denenecek
              </span>
            )}
          </p>
        )}

        <div className="mb-3 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--ink-3)' }}>
          <span>{c.calls} çağrı</span>
          <span>{c.fails} hata</span>
          {!c.free && <span>{fmtMoney(c.costUsd)}</span>}
          {c.lastOkAt && <span>son başarı {fmtDate(c.lastOkAt)}</span>}
        </div>

        <form action={kaydet} className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Ad</label>
            <input name="label" defaultValue={c.label} className="input" />
          </div>
          <div>
            <label className="label">Model</label>
            <input
              name="model"
              defaultValue={c.model ?? ''}
              className="input"
              placeholder={preset?.model}
            />
          </div>

          {c.provider === 'openai-compatible' && (
            <div className="md:col-span-2">
              <label className="label">Sunucu adresi (base URL)</label>
              <input name="baseUrl" defaultValue={c.baseUrl ?? ''} className="input" />
            </div>
          )}
          {c.provider !== 'openai-compatible' && (
            <input type="hidden" name="baseUrl" value={c.baseUrl ?? ''} />
          )}

          <div className="md:col-span-2">
            <label className="label">
              API anahtarı{' '}
              <span style={{ color: 'var(--ink-3)' }}>— kayıtlı: {mask(c.apiKey ? '••••••••' : '')}</span>
            </label>
            <input
              name="apiKey"
              type="password"
              autoComplete="off"
              className="input"
              placeholder={
                preset?.keyless
                  ? 'Bu sağlayıcı anahtar istemiyor'
                  : 'Değiştirmek için yazın, silmek için tek tire (-)'
              }
            />
          </div>

          {c.extra ? (
            <div className="md:col-span-2">
              <label className="label">Ek alanlar (JSON)</label>
              <input
                name="extraJson"
                defaultValue={JSON.stringify(c.extra)}
                className="input font-mono text-xs"
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-4 md:col-span-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={c.enabled} className="size-4" />
              Etkin
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" name="free" defaultChecked={c.free} className="size-4" />
              Ücretsiz (maliyete sayma)
            </label>
            {c.kind === 'TEXT' && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" name="vision" defaultChecked={c.vision} className="size-4" />
                Görsel denetimi yapabilir
              </label>
            )}
          </div>

          <div className="flex flex-wrap gap-2 md:col-span-2">
            <button type="submit" className="btn-primary btn-sm">
              Kaydet
            </button>
            <button type="submit" formAction={test} className="btn btn-sm">
              <IconCheck className="size-3.5" />
              Bağlantıyı dene
            </button>
            {c.health !== 'OK' && (
              <button type="submit" formAction={sifirla} className="btn btn-sm">
                Durumu sıfırla
              </button>
            )}
            {index > 0 && (
              <button type="submit" formAction={yukari} className="btn btn-sm" title="Yukarı taşı">
                ↑
              </button>
            )}
            {index < total - 1 && (
              <button type="submit" formAction={asagi} className="btn btn-sm" title="Aşağı taşı">
                ↓
              </button>
            )}
            <button
              type="submit"
              formAction={sil}
              className="btn-ghost btn-sm ml-auto"
              style={{ color: 'var(--err)' }}
            >
              <IconTrash className="size-3.5" />
              Sil
            </button>
          </div>
        </form>
      </div>
    </details>
  );
}

function AddForm({ kind, presets }: { kind: CredentialKind; presets: Preset[] }) {
  return (
    <details className="mt-4">
      <summary className="btn btn-sm inline-flex cursor-pointer">
        <IconPlus className="size-3.5" />
        Sağlayıcı ekle
      </summary>

      <form
        action={addCredential}
        className="mt-3 rounded-lg p-3"
        style={{ border: '1px solid var(--line)', background: 'var(--surface-2)' }}
      >
        <input type="hidden" name="kind" value={kind} />

        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="label">Hazır ön ayar</label>
            <select name="preset" className="input" defaultValue="">
              <option value="">— özel tanım —</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.free ? ' (ücretsiz)' : ''}
                </option>
              ))}
            </select>
            <p className="hint">
              Ön ayar seçerseniz adres ve model otomatik dolar; yalnızca anahtarı girmeniz yeter.
            </p>

            {presets.some((p) => p.hint) && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs" style={{ color: 'var(--ink-3)' }}>
                  Ön ayarlar hakkında
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {presets
                    .filter((p) => p.hint)
                    .map((p) => (
                      <li key={p.id} className="text-xs">
                        <span className="font-medium">{p.label}</span>
                        {p.keyless && <span className="ml-1.5 pill-accent">anahtarsız</span>}
                        {p.free && !p.keyless && (
                          <span className="ml-1.5 pill-neutral">ücretsiz</span>
                        )}
                        <span className="block" style={{ color: 'var(--ink-3)' }}>
                          {p.hint}
                        </span>
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </div>

          <div>
            <label className="label">Ad (isteğe bağlı)</label>
            <input name="label" className="input" placeholder="Ön ayardan alınır" />
          </div>
          <div>
            <label className="label">Model (isteğe bağlı)</label>
            <input name="model" className="input" placeholder="Ön ayardan alınır" />
          </div>

          <div className="md:col-span-2">
            <label className="label">API anahtarı</label>
            <input name="apiKey" type="password" autoComplete="off" className="input" />
          </div>

          <div className="md:col-span-2">
            <label className="label">Özel tanım için: sağlayıcı ve adres</label>
            <div className="grid gap-3 md:grid-cols-2">
              <select name="provider" className="input" defaultValue="">
                <option value="">— ön ayardan al —</option>
                {kind === 'TEXT' ? (
                  <>
                    <option value="anthropic">anthropic</option>
                    <option value="openai">openai</option>
                    <option value="openai-compatible">openai-compatible</option>
                  </>
                ) : (
                  <>
                    <option value="openai">openai</option>
                    <option value="gemini">gemini</option>
                    <option value="ideogram">ideogram</option>
                    <option value="stability">stability</option>
                    <option value="pollinations">pollinations</option>
                    <option value="cloudflare">cloudflare</option>
                    <option value="huggingface">huggingface</option>
                  </>
                )}
              </select>
              <input name="baseUrl" className="input" placeholder="https://.../v1" />
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="label">Cloudflare için hesap kimliği</label>
            <input name="extra_accountId" className="input" placeholder="yalnızca Cloudflare" />
          </div>

          <div className="flex flex-wrap items-center gap-4 md:col-span-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" name="free" className="size-4" />
              Ücretsiz
            </label>
            {kind === 'TEXT' && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" name="vision" className="size-4" />
                Görsel denetimi yapabilir
              </label>
            )}
          </div>
        </div>

        <button type="submit" className="btn-primary mt-3">
          Havuza ekle
        </button>
      </form>
    </details>
  );
}

export function CredentialPool({
  kind,
  title,
  description,
  items,
  presets,
}: {
  kind: CredentialKind;
  title: string;
  description: string;
  items: ApiCredential[];
  presets: Preset[];
}) {
  const testAll = testAllCredentials.bind(null, kind);
  const aktif = items.filter((c) => c.enabled && c.health !== 'BROKEN').length;

  return (
    <Panel
      title={title}
      action={
        items.length > 0 ? (
          <form action={testAll}>
            <button className="btn btn-sm">
              <IconRefresh className="size-3.5" />
              Hepsini dene
            </button>
          </form>
        ) : null
      }
    >
      <p className="mb-4 text-xs" style={{ color: 'var(--ink-3)' }}>
        {description}
      </p>

      {items.length === 0 ? (
        <Alert tone="warn">
          Tanımlı sağlayıcı yok. En az bir tane eklemezseniz bu adım hiç çalışmaz.
        </Alert>
      ) : aktif === 0 ? (
        <Alert tone="err">
          Kullanılabilir sağlayıcı kalmadı; hepsi kapalı veya arızalı. Üretim duracak.
        </Alert>
      ) : aktif === 1 ? (
        <Alert tone="warn">
          Tek sağlayıcı var. O düşerse üretim durur — yedek olarak ücretsiz bir sağlayıcı
          eklemenizi öneririm.
        </Alert>
      ) : null}

      <div className="mt-3 space-y-2">
        {items.map((c, i) => (
          <Row key={c.id} c={c} index={i} total={items.length} presets={presets} />
        ))}
      </div>

      <AddForm kind={kind} presets={presets} />
    </Panel>
  );
}
