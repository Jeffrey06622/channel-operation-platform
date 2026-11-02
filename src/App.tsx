import { Suspense, lazy, useState } from 'react';
import { Loader2 } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import LoginScreen from './components/LoginScreen';
import { clearTeacherSecret } from './auth';
import type { GroupRow } from './types';

const StudentDashboard = lazy(() => import('./components/StudentDashboard'));
const TeacherDashboard = lazy(() => import('./components/TeacherDashboard'));

const STORAGE_KEY = 'hotel-decision-session';

type Session =
  | { role: 'guest' }
  | { role: 'group'; group: GroupRow }
  | { role: 'teacher' };

function loadSession(): Session {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { role: 'guest' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return { role: 'guest' };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      localStorage.removeItem(STORAGE_KEY);
      return { role: 'guest' };
    }
    const p = parsed as Record<string, unknown>;
    if (p.role === 'group') {
      const g = p.group as Record<string, unknown> | undefined;
      if (g && typeof g.id === 'string' && typeof g.name === 'string') {
        return { role: 'group', group: g as unknown as GroupRow };
      }
      localStorage.removeItem(STORAGE_KEY);
      return { role: 'guest' };
    }
    if (p.role === 'teacher') return { role: 'teacher' };
    localStorage.removeItem(STORAGE_KEY);
    return { role: 'guest' };
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return { role: 'guest' };
  }
}

function saveSession(s: Session) {
  try {
    if (s.role === 'guest') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }
  } catch {
    // ignore storage errors
  }
}

function App() {
  const [session, setSession] = useState<Session>(loadSession);

  function updateSession(s: Session) {
    // Leaving the teacher session must also drop the in-memory teacher
    // password, otherwise a later visitor on the same page could call the
    // teacher-only RPCs without authenticating.
    if (s.role !== 'teacher') clearTeacherSecret();
    saveSession(s);
    setSession(s);
  }

  let content: React.ReactNode;
  if (session.role === 'guest') {
    content = (
      <LoginScreen
        onGroupLogin={(group) => updateSession({ role: 'group', group })}
        onTeacherLogin={() => updateSession({ role: 'teacher' })}
      />
    );
  } else if (session.role === 'group') {
    content = (
      <StudentDashboard
        group={session.group}
        onGroupUpdate={(group) => updateSession({ role: 'group', group })}
        onLogout={() => updateSession({ role: 'guest' })}
      />
    );
  } else {
    content = <TeacherDashboard onLogout={() => updateSession({ role: 'guest' })} />;
  }

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
          </div>
        }
      >
        {content}
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
