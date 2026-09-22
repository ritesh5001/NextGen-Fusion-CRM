import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { loginRequest } from '@/api/auth';
import { apiError } from '@/api/client';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';

export function LoginPage() {
  const { token, setAuth } = useAuthStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  if (token) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { token, user } = await loginRequest(email, password);
      setAuth(token, user);
      toast.success(`Welcome back, ${user.name}`);
      navigate('/');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-white p-4 dark:bg-gray-950">
      {/* Soft brand glow behind the card, echoing the nextgenfusion.in hero. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-600/10 blur-3xl" />
        <div className="absolute -right-24 top-1/3 h-80 w-80 rounded-full bg-fusion-violet/10 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-fusion-cyan/10 blur-3xl" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          {/* The logo is black-on-transparent, so it sits on a white pad to stay visible in dark mode. */}
          <div className="mb-5 rounded-btn bg-white px-3 py-2">
            <img src="/logo.png" alt="NextGen Fusion" className="h-14 w-auto" />
          </div>
          <span className="mb-4 inline-flex items-center gap-2 rounded-btn border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Telecaller Management
            <span className="text-gray-400 dark:text-gray-500">· NextGen Fusion</span>
          </span>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Welcome <span className="text-gradient">back</span>
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Sign in to your CRM workspace</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white/90 p-6 shadow-xl shadow-gray-200/50 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90 dark:shadow-none sm:p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@nextgenfusion.in"
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <Button type="submit" loading={loading} className="w-full py-3 md:py-2.5">
            Sign in
          </Button>
        </form>
        </div>
      </div>
    </div>
  );
}
