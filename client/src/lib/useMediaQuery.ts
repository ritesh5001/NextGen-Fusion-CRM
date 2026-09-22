import { useEffect, useState } from 'react';

/** Subscribes to a CSS media query from JS. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * True below Tailwind's `md` breakpoint — the same line the layout uses to swap
 * the sidebar for the tab bar and the tables for cards. Use it only where CSS
 * can't do the job (rendering a different component, not a different style).
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
