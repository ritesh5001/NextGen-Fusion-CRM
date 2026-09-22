import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppRoutes } from '@/routes/router';
import { useUiStore } from '@/store/ui';

export default function App() {
  const theme = useUiStore((s) => s.theme);

  // Reflect the selected theme on <html> so Tailwind's `dark:` variants apply app-wide.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <BrowserRouter>
      <AppRoutes />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          className: theme === 'dark' ? '!bg-slate-800 !text-slate-100' : '',
        }}
      />
    </BrowserRouter>
  );
}
