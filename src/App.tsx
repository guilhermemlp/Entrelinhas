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
    // INITIAL_SESSION já considera a sessão persistida no localStorage.
    // Centralizar a inicialização no listener evita a corrida entre getSession()
    // e eventos de autenticação (por exemplo, o retorno do link mágico).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setReady(true);
    });

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
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sending || cooldown > 0) return;
    setError('');
    setSending(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: getAuthRedirectUrl() },
      });
      if (error) {
        const rateLimited = /rate.?limit|too many requests|email rate limit/i.test(error.message);
        setError(rateLimited
          ? 'O serviço de e-mail atingiu temporariamente o limite de envios. Aguarde antes de solicitar outro link. Se já recebeu um e-mail recentemente, use o link mais novo que ainda estiver válido.'
          : 'Não foi possível solicitar o acesso. Verifique o endereço de e-mail e tente novamente.');
        if (rateLimited) setCooldown(60);
      } else {
        setSent(true);
      }
    } catch {
      setError('Não foi possível conectar ao serviço de autenticação. Verifique sua conexão e tente novamente.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="login">
      <h1>Entrelinhas</h1>
      {sent ? (
        <p>Se o endereço estiver habilitado, enviaremos um link de acesso para {email}. Abra-o neste dispositivo. Confira também a caixa de spam.</p>
      ) : (
        <form onSubmit={onSubmit}>
          <label>
            E-mail
            <input type="email" required autoComplete="email" value={email}
              onChange={e => setEmail(e.target.value)} disabled={sending} />
          </label>
          <button type="submit" className="primary" disabled={sending || cooldown > 0}>
            {sending ? 'Solicitando…' : cooldown > 0 ? `Aguarde ${cooldown}s` : 'Receber link de acesso'}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      )}
    </main>
  );
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('registro');
  const [date, setDate] = useState(localDateKey());
  const [online, setOnline] = useState(navigator.onLine);
  const today = localDateKey();

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  function openDate(d: string) {
    setDate(d);
    setTab('registro');
  }

  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">Entrelinhas</strong>
        <button type="button" className="link" onClick={onSignOut}>Sair</button>
      </header>

      {!online && <div className="offline-banner" role="status">Sem conexão. As alterações podem ficar apenas neste navegador até a sincronização.</div>}

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
        <TabButton active={tab === 'registro'} onClick={() => { setDate(today); setTab('registro'); }}{'Meu dia'}</TabButton>
        <TabButton active={tab === 'calendario'} onClick={() => setTab('calendario')}>Histórico</TabButton>
        <TabButton active={tab === 'analise'} onClick={() => setTab('analise')}>Análises</TabButton>
        <TabButton active={tab === 'dados'} onClick={() => setTab('dados')}>Dados e configurações</TabButton>
      </nav>
    </div>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" className={active ? 'tab active' : 'tab'} aria-current={active ? 'page' : undefined} onClick={onClick}>
      {children}
    </button>
  );
}
