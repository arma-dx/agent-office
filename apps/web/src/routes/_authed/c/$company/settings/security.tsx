import { createFileRoute } from '@tanstack/react-router';
import { PasskeysSection } from '@/components/security-settings';

/**
 * Settings, Güvenlik: the person's passkeys, for every signed-in person. Passkeys belong to the
 * person, not to the company in the URL.
 */
export const Route = createFileRoute('/_authed/c/$company/settings/security')({
  staticData: { location: { label: 'Güvenlik', parent: 'Ayarlar' } },
  component: SecuritySettingsScreen,
});

function SecuritySettingsScreen() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-secondary">
          Önemli onaylar ve üye değişiklikleri için parmak izi ya da yüz tanımayla yeniden doğrulama
          istenir. İki cihazda passkey eklemeniz önerilir.
        </p>
      </div>
      <PasskeysSection />
    </div>
  );
}
