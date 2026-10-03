/** data-theme on the root element follows the system light or dark preference. */
export function watchTheme(root: HTMLElement = document.documentElement): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    root.dataset['theme'] = query.matches ? 'dark' : 'light';
  };
  apply();
  query.addEventListener('change', apply);
  return () => {
    query.removeEventListener('change', apply);
  };
}
