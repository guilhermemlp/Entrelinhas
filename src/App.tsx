import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { localDateKey } from './domain/dates';
import { DailyForm } from './ui/DailyForm';
import { Calendar } from './ui/Calendar';
import { Analysis } from './ui/Analysis';
import { DataPanel } from './ui/DataPanel';

type Tab = 'registro' | 'calendario' | 'analise' | 'dados';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    // INITIAL_SESSION já considera a sessão persistida no localStorage.
    // Centralizar a inicialização no listener evita a corrida entre getSession()
    // e eventos de autenticação (por exemplo, o retorno do link mágico).
    const { data: sub } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      setSession(currentSession);
      setReady(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <p className="center">Carregando…</p>;
  if (passwordRecovery && session) {
    return <PasswordUpdate onComplete={() => setPasswordRecovery(false)} />;
  }
  if (!session) return <Login />;
  return <Shell onSignOut={() => supabase.auth.signOut()} />;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'login' | 'recovery'>('login');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setMessage('Se o endereço estiver cadastrado, você receberá um e-mail para definir uma nova senha.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível concluir a solicitação.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">e.</span>
        <span><strong className="brand">Entrelinhas</strong><small>DIÁRIO DE AUTO-OBSERVAÇÃO</small></span>
      </div>
      <h1>{mode === 'login' ? 'Entre no seu espaço' : 'Definir ou recuperar senha'}</h1>
      <p className="muted">
        {mode === 'login'
          ? 'Acesse com seu e-mail e senha. Você permanecerá conectado neste navegador.'
          : 'Enviaremos um link para o e-mail cadastrado. Use-o uma vez para definir sua senha.'}
      </p>
      <form onSubmit={submit}>
        <label htmlFor="auth-email">E-mail</label>
        <input
          id="auth-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={event => setEmail(event.target.value)}
          disabled={busy}
        />
        {mode === 'login' && (
          <>
            <label htmlFor="auth-password">Senha</label>
            <input
              id="auth-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
              disabled={busy}
            />
          </>
        )}
        <button className="primary" type="submit" disabled={busy || !email.trim() || (mode === 'login' && !password)}>
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Enviar link para definir senha'}
        </button>
      </form>
      {message && <p className="message" role="status">{message}</p>}
      <p>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'recovery' : 'login'); setMessage(''); }}>
          {mode === 'login' ? 'Esqueci ou ainda preciso definir minha senha' : 'Voltar para entrar'}
        </button>
      </p>
    </main>
  );
}

function PasswordUpdate({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setMessage('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirmation) {
      setMessage('As senhas não correspondem.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      onComplete();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar a senha.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <h1>Crie sua senha</h1>
      <p className="muted">Depois disso, você poderá entrar diretamente com e-mail e senha, sem solicitar novos links.</p>
      <form onSubmit={submit}>
        <label htmlFor="new-password">Nova senha</label>
        <input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
        <label htmlFor="confirm-password">Confirme a senha</label>
        <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar senha'}</button>
      </form>
      {message && <p className="message error" role="alert">{message}</p>}
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
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">e.</span>
          <span><strong className="brand">Entrelinhas</strong><small>DIÁRIO DE AUTO-OBSERVAÇÃO</small></span>
        </div>
        <div className="topbar-actions">
          <span className="connection-state"><i /> {online ? 'Sincronizado' : 'Offline'}</span>
          <button type="button" className="link" onClick={onSignOut}>Sair</button>
        </div>
      </header>

      {!online && <div className="offline-banner" role="status">Sem conexão. As alterações podem ficar apenas neste navegador até a sincronização.</div>}

      <div className="shell-layout">
        <aside className="side-rail">
          <span className="side-label">ESPAÇO PESSOAL</span>
          <nav className="tabbar" aria-label="Navegação principal">
            <TabButton active={tab === 'registro' && date === today} onClick={() => { setDate(today); setTab('registro'); }}><span className="nav-icon">◷</span>Meu dia</TabButton>
            <TabButton active={tab === 'calendario' || (tab === 'registro' && date !== today)} onClick={() => setTab('calendario')}><span className="nav-icon">▦</span>Histórico</TabButton>
            <TabButton active={tab === 'analise'} onClick={() => setTab('analise')}><span className="nav-icon">⌁</span>Análises</TabButton>
          </nav>
          <div className="side-divider" />
          <TabButton active={tab === 'dados'} onClick={() => setTab('dados')}><span className="nav-icon">⚙</span>Dados e configurações</TabButton>
          <div className="side-note"><span className="side-note-mark">✳</span><p>Um espaço para observar padrões, sem pressa de encontrar respostas.</p></div>
        </aside>

        <nav className="mobile-tabbar" aria-label="Navegação principal">
          <TabButton active={tab === 'registro' && date === today} onClick={() => { setDate(today); setTab('registro'); }}><span className="nav-icon" aria-hidden="true">◷</span><span>Meu dia</span></TabButton>
          <TabButton active={tab === 'calendario' || (tab === 'registro' && date !== today)} onClick={() => setTab('calendario')}><span className="nav-icon" aria-hidden="true">▦</span><span>Histórico</span></TabButton>
          <TabButton active={tab === 'analise'} onClick={() => setTab('analise')}><span className="nav-icon" aria-hidden="true">⌁</span><span>Análises</span></TabButton>
          <TabButton active={tab === 'dados'} onClick={() => setTab('dados')}><span className="nav-icon" aria-hidden="true">⚙</span><span>Dados</span></TabButton>
        </nav>

        <main className="content">
          {tab === 'registro' && (
            <>
              {date !== today && (
                <button type="button" className="link back" onClick={() => setDate(today)}>
                  ← Voltar para hoje
                </button>
              )}
              <div className="entry-context">
                <span className="eyebrow">{date === today ? 'SEU ESPAÇO DE OBSERVAÇÃO' : 'HISTÓRICO · REGISTRO SELECIONADO'}</span>
                <h1>{date === today ? 'Como foi seu dia?' : 'Revisitar um dia'}</h1>
                <p>{date === today ? 'Perceba, registre e acompanhe. Não é preciso interpretar tudo agora.' : 'Consulte ou atualize as observações deste dia.'}</p>
              </div>
              <DailyForm key={date} date={date} />
            </>
          )}
          {tab === 'calendario' && <Calendar onSelect={openDate} />}
          {tab === 'analise' && <Analysis />}
          {tab === 'dados' && <DataPanel onSignOut={onSignOut} />}
        </main>
      </div>
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
