import { useEffect, useState } from 'react';
import { api } from '../api';

interface Props {
  onLogin: (token: string, user: any) => void;
}

export default function MicrosoftCallback({ onLogin }: Props) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (!code) {
      setError('Missing authorization code');
      return;
    }
    const redirectUri = `${window.location.origin}/auth/microsoft/callback`;
    api.microsoftAuthCallback(code, redirectUri)
      .then(({ token, user }) => {
        window.history.replaceState({}, '', '/');
        onLogin(token, user);
      })
      .catch((err) => {
        setError(err?.message || 'Authentication failed');
      });
  }, [onLogin]);

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Signing in…</h1>
        {error && <div className="error-banner">{error}</div>}
      </div>
    </div>
  );
}