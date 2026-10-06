// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/PropertiesPanel.tsx (the docked panel, lines 339-439),
// ui/src/components/side-panel/SidePanelFrame.tsx (the 60 px header) and
// ui/src/context/PanelContext.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: a fixed 320 px panel with a title; the page renders its properties through a portal
// instead of storing a node in context; closed by default; a page may ask for the panel while its
// content exists; a hidden panel leaves the tab order; the toggle lives in the top bar; no resize,
// maximize, tabs or width animation.
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { PROPERTIES_PANEL_ID, useShell } from '@/lib/shell';

/**
 * What a detail page shows in the properties panel. The page renders this anywhere inside itself;
 * the content appears in the shell's panel and keeps the page's own context (queries, forms).
 *
 * With `open` the panel shows for as long as this content exists, whatever the person's choice is,
 * and the toggle is not offered meanwhile. It is for the properties of a selection that the page
 * clears itself (the office view): hiding them would leave a selected thing without its detail.
 * The person's stored choice is neither read nor written.
 */
export function PropertiesPanel({
  children,
  open = false,
}: {
  children: ReactNode;
  open?: boolean;
}) {
  const { panelHost, registerPanel } = useShell();
  // A layout effect: the shell shows the panel and its toggle in the same paint as the page. With a
  // passive effect the page was painted once at full width and then jumped 320 px narrower.
  useLayoutEffect(() => registerPanel({ open }), [registerPanel, open]);
  return panelHost ? createPortal(children, panelHost) : null;
}

/**
 * Shell side: the region on the right, under the top bar and as high as the rest of the window.
 * It takes space only while a page uses it, and then when the person has opened it or the page
 * asks for it.
 */
export function PanelRegion() {
  const { panelOpen, panelInUse, panelRequested, setPanelHost } = useShell();
  return (
    <aside
      id={PROPERTIES_PANEL_ID}
      aria-label="Özellikler"
      hidden={!(panelInUse && (panelOpen || panelRequested))}
      className="sticky top-15 flex h-[calc(100dvh-3.75rem)] w-80 shrink-0 flex-col border-l border-line bg-surface"
    >
      <div className="flex h-15 shrink-0 items-center border-b border-line px-4">
        <h2 className="text-[0.9375rem] font-medium">Özellikler</h2>
      </div>
      <div ref={setPanelHost} className="min-h-0 flex-1 overflow-y-auto p-4" />
    </aside>
  );
}

/**
 * Top bar button that shows or hides the panel; present only while a page uses the panel. Not
 * while the page asks for the panel itself: that panel closes when the page clears its selection.
 */
export function PanelToggle() {
  const { panelOpen, panelInUse, panelRequested, togglePanel } = useShell();
  if (!panelInUse || panelRequested) return null;
  const label = panelOpen ? 'Özellikleri gizle' : 'Özellikleri göster';
  return (
    <Button
      variant="ghost"
      size="icon"
      className="aria-expanded:bg-transparent aria-expanded:hover:bg-muted"
      aria-label={label}
      title={label}
      aria-expanded={panelOpen}
      aria-controls={PROPERTIES_PANEL_ID}
      onClick={togglePanel}
    >
      {panelOpen ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
    </Button>
  );
}
