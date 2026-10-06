/**
 * Marks the root element with the last kind of input: data-input="pointer" after a press of the
 * mouse, a finger or a pen, data-input="keyboard" after a key. index.css reads the mark to leave
 * out the focus ring on menu rows and menu buttons while a menu is used with the pointer. Nothing
 * is stored. Returns a function that stops it.
 */
export function trackInputKind(root: HTMLElement = document.documentElement): () => void {
  const onPointer = () => {
    root.dataset['input'] = 'pointer';
  };
  const onKey = () => {
    root.dataset['input'] = 'keyboard';
  };
  // Capture phase: the mark is set before a component handles, or stops, the same event.
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('keydown', onKey, true);
  return () => {
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
  };
}
