import { Toaster as Sonner, type ToasterProps } from 'sonner';
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react';
import { useTheme } from '@/lib/theme';

// sonner's default shortcut (Alt+T) moves the focus to the toast list. On a Turkish Q keyboard
// that combination types the lira sign, so a person typing in a field lost the focus while a toast
// was on screen. Toasts are announced through the live region; the one kind that carries a
// button (a notice that stays until it is closed) is reached with Tab.
const NO_HOTKEY: string[] = [];

const Toaster = ({ ...props }: ToasterProps) => {
  // The toaster follows the theme chosen in the account menu, not the device on its own.
  const theme = useTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      // The name of the region, in Turkish and without the shortcut sonner appends to its default.
      // Not "Bildirimler": that is the list of a person's notifications on the Bugün screen.
      customAriaLabel="Anlık bildirimler"
      hotkey={NO_HOTKEY}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        // The name of the close button of a toast that stays until it is closed.
        closeButtonAriaLabel: 'Bildirimi kapat',
        classNames: {
          // No shadow (CLAUDE.md design rules): the toast is set apart by its border. sonner draws
          // both its shadow and its focus ring as a box-shadow from an unlayered rule, hence the
          // important marks; the ring comes back as our outline.
          toast:
            'cn-toast shadow-none! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
          // The close button's focus ring is a box-shadow too.
          closeButton:
            'shadow-none! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
