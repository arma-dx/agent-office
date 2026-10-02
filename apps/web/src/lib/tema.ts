/** Kök öğedeki data-theme sistemin açık ya da karanlık tercihini izler. */
export function temayiIzle(kok: HTMLElement = document.documentElement): () => void {
  const sorgu = window.matchMedia('(prefers-color-scheme: dark)');
  const uygula = () => {
    kok.dataset['theme'] = sorgu.matches ? 'dark' : 'light';
  };
  uygula();
  sorgu.addEventListener('change', uygula);
  return () => {
    sorgu.removeEventListener('change', uygula);
  };
}
