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
  return (
    <main className="login">
      <h1>Entrelinhas</h1>
      <p role="status">
        A entrada por e-mail está temporariamente desativada.
        Se você já tinha uma sessão ativa, atualize a página para continuar.
      </p>
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
