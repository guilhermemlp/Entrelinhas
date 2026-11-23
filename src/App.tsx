import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { localDateKey } from './domain/dates';
import { DailyForm } from './ui/DailyForm';
import { Calendar } from './ui/Calendar';
import { Analysis } from './ui/Analysis';
import { DataPanel } from './ui/DataPanel';

type Tab = 'registro' | 'calendario' | 'analise' | 'dados';

// Em produção, não permita que links mágicos sejam enviados para localhost
// mesmo se a aplicação tiver sido aberta por um endereço local por engano.
const PRODUCTION_URL = 'https://entrelinhas-guiimagnos-projects.vercel.app';
const getAuthRedirectUrl = () =>
  import.meta.env.PROD ? PRODUCTION_URL : window.location.origin;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <p className="center">Carregando…</p>;
  if (!session) return <Login />;
  return <Shell onSignOut={() => supabase.auth.signOut()} />;
}

function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: getAuthRedirectUrl() },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="login">
      <h1>Diário</h1>
      {sent ? (
        <p>Enviamos um link de acesso para {email}. Abra-o neste dispositivo.</p>
      ) : (
        <form onSubmit={onSubmit}>
          <label>
            E-mail
            <input type="email" required autoComplete="email" value={email}
              onChange={e => setEmail(e.target.value)} />
          </label>
          <button type="submit" className="primary">Receber link de acesso</button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </main>
  );
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('registro');
  const [date, setDate] = useState(localDateKey());
  const today = localDateKey();

  function openDate(d: string) {
    setDate(d);
    setTab('registro');
  }

  return (
    <div className="shell">
      <header className="topbar">
        <strong>Diário</strong>
        <button type="button" className="link" onClick={onSignOut}>Sair</button>
      </header>

      <main className="content">
        {tab === 'registro' && (
          <>
            {date !== today && (
              <button type="button" className="link back" onClick={() => setDate(today)}>
                ← Voltar para hoje
              </button>
            )}
            <DailyForm key={date} date={date} />
          </>
        )}
        {tab === 'calendario' && <Calendar onSelect={openDate} />}
        {tab === 'analise' && <Analysis />}
        {tab === 'dados' && <DataPanel onSignOut={onSignOut} />}
      </main>

      <nav className="tabbar" aria-label="Navegação principal">
        <TabButton active={tab === 'registro'} onClick={() => { setDate(today); setTab('registro'); }}>Hoje</TabButton>
        <TabButton active={tab === 'calendario'} onClick={() => setTab('calendario')}>Calendário</TabButton>
        <TabButton active={tab === 'analise'} onClick={() => setTab('analise')}>Análise</TabButton>
        <TabButton active={tab === 'dados'} onClick={() => setTab('dados')}>Dados</TabButton>
      </nav>
    </div>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" className={active ? 'tab active' : 'tab'} onClick={onClick}>
      {children}
    </button>
  );
}
