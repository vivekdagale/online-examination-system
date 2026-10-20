'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

type StudentSession = {
  accessToken: string;
  user: { id: string; name: string; email: string; role: 'STUDENT' };
};
type StudentAnswer = {
  questionId: string;
  selectedIds: string[];
  textAnswer?: string | null;
  isFlagged: boolean;
};
type ExamQuestion = {
  id: string;
  prompt: string;
  type: 'SINGLE_CHOICE' | 'MULTIPLE_SELECT' | 'DESCRIPTIVE';
  marks: number;
  position: number;
  options: { id: string; text: string; position: number }[];
};
type Attempt = {
  id: string;
  studentId: string;
  status: string;
  deadlineAt: string;
  serverNow: string;
  submissionReason: string | null;
  answers: StudentAnswer[];
  exam: {
    id: string;
    title: string;
    instructions: string;
    durationMinutes: number;
    maxMarks: number;
    questions: ExamQuestion[];
  };
};
type StudentExam = {
  id: string;
  title: string;
  subject: string;
  instructions: string;
  status: string;
  state: 'AVAILABLE' | 'UPCOMING' | 'ONGOING' | 'COMPLETED' | 'CLOSED';
  durationMinutes: number;
  opensAt: string;
  closesAt: string;
  maxMarks: number;
  passMarks: number;
  questionCount: number;
  attempt: {
    id: string;
    status: string;
    startedAt: string;
    submittedAt: string | null;
    deadlineAt: string | null;
    submissionReason: string | null;
    result: PublishedResult | null;
  } | null;
};
type PublishedResult = {
  id: string;
  objectiveMarks: number;
  descriptiveMarks: number | null;
  totalMarks: number | null;
  passed: boolean | null;
  status: string;
  publishedAt: string | null;
  attempt: {
    exam: { title: string; subject: string; maxMarks: number; passMarks: number };
    answers: {
      questionId: string;
      awardedMarks: number | null;
      feedback: string | null;
      question: { prompt: string; position: number; marks: number };
    }[];
  };
};
type Dashboard = {
  stats: {
    availableExams: number;
    upcomingExams: number;
    ongoingAttempts: number;
    completedExams: number;
    publishedResults: number;
  };
  exams: StudentExam[];
  results: PublishedResult[];
};
type LocalAnswer = { selectedIds: string[]; textAnswer: string; isFlagged: boolean };

async function api<T>(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  const data = await response.json().catch(() => ({
    message: 'Unexpected server response.',
  }));
  if (!response.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join(', ')
      : data.message || `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

function stateClass(state: string) {
  if (state === 'AVAILABLE' || state === 'PUBLISHED') return 'bg-emerald-50 text-emerald-700';
  if (state === 'ONGOING') return 'bg-blue-50 text-blue-700';
  if (state === 'UPCOMING') return 'bg-amber-50 text-amber-800';
  if (state === 'COMPLETED') return 'bg-violet-50 text-violet-700';
  return 'bg-slate-100 text-slate-600';
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function StudentPage() {
  const [session, setSession] = useState<StudentSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, LocalAnswer>>({});
  const [seconds, setSeconds] = useState(0);
  const [current, setCurrent] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const [section, setSection] = useState<'overview' | 'exams' | 'history' | 'results'>('overview');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveChains = useRef<Record<string, Promise<void>>>({});
  const submitting = useRef(false);
  const sectionRef = useRef(section);
  sectionRef.current = section;

  useEffect(() => {
    const stored = window.localStorage.getItem('oes_student_session');
    if (stored) {
      try {
        const value: unknown = JSON.parse(stored);
        if (
          typeof value === 'object' &&
          value !== null &&
          'accessToken' in value &&
          'user' in value &&
          typeof value.accessToken === 'string' &&
          typeof value.user === 'object' &&
          value.user !== null &&
          'role' in value.user &&
          value.user.role === 'STUDENT'
        ) {
          setSession(value as StudentSession);
        } else {
          window.localStorage.removeItem('oes_student_session');
        }
      } catch {
        window.localStorage.removeItem('oes_student_session');
      }
    }
    setSessionReady(true);
  }, []);

  async function loadDashboard(
    activeSession: StudentSession,
    resume = false,
  ): Promise<Dashboard | null> {
    setLoading(true);
    setError('');
    try {
      const next = await api<Dashboard>('/student/dashboard', activeSession.accessToken);
      setDashboard(next);
      if (resume) {
        const active = next.exams.find((exam) => exam.state === 'ONGOING');
        if (active?.attempt) await openAttempt(active.attempt.id, activeSession, false);
      }
      return next;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Unable to load your dashboard.';
      setError(detail);
      if (
        detail.includes('Insufficient role permissions') ||
        detail.includes('Invalid or expired') ||
        detail.includes('required')
      ) {
        window.localStorage.removeItem('oes_student_session');
        setSession(null);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session) void loadDashboard(session, true);
  }, [session]);

  useEffect(() => {
    if (!attempt) return;
    const tick = () => {
      const deadline = new Date(attempt.deadlineAt).getTime();
      const adjustedNow = Date.now() + serverOffset;
      setSeconds(Math.max(0, Math.ceil((deadline - adjustedNow) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [attempt, serverOffset]);

  const activeQuestion = attempt?.exam.questions[current];
  const answeredCount = attempt
    ? attempt.exam.questions.filter((question) => {
        const answer = answers[question.id];
        return !!answer && (
          answer.selectedIds.length > 0 || answer.textAnswer.trim().length > 0
        );
      }).length
    : 0;
  const flaggedCount = attempt
    ? attempt.exam.questions.filter((question) => answers[question.id]?.isFlagged).length
    : 0;
  const timeLabel = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const results = dashboard?.results ?? [];
  const ongoing = dashboard?.exams.filter((exam) => exam.state === 'ONGOING') ?? [];

  async function openAttempt(
    attemptId: string,
    activeSession = session,
    showMessage = true,
  ) {
    if (!activeSession) return;
    try {
      const data = await api<Attempt>(
        `/attempts/${encodeURIComponent(attemptId)}`,
        activeSession.accessToken,
      );
      if (data.status !== 'IN_PROGRESS') {
        throw new Error('This examination has already been submitted. Re-entry is not allowed.');
      }
      setServerOffset(new Date(data.serverNow).getTime() - Date.now());
      setAttempt(data);
      setCurrent(0);
      const restored: Record<string, LocalAnswer> = {};
      for (const answer of data.answers) {
        restored[answer.questionId] = {
          selectedIds: answer.selectedIds ?? [],
          textAnswer: answer.textAnswer ?? '',
          isFlagged: answer.isFlagged,
        };
      }
      setAnswers(restored);
      setSection('exams');
      if (showMessage) setMessage('Attempt restored from the server. Your saved answers are loaded.');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to restore this attempt.');
      if (activeSession) await loadDashboard(activeSession);
    }
  }

  async function refreshDashboard() {
    if (session) await loadDashboard(session);
  }

  async function startExam(exam: StudentExam) {
    if (!session) return;
    if (!window.confirm(`Start "${exam.title}"? The server starts your examination timer when you continue.`)) return;
    setBusy(true);
    setError('');
    try {
      const started = await api<{ id: string; resumed?: boolean }>(
        `/exams/${encodeURIComponent(exam.id)}/start`,
        session.accessToken,
        { method: 'POST', body: JSON.stringify({ acknowledge: true }) },
      );
      await openAttempt(started.id, session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start examination.');
      await loadDashboard(session);
    } finally {
      setBusy(false);
    }
  }

  async function persistAnswer(
    attemptId: string,
    questionId: string,
    answer: LocalAnswer,
    accessToken: string,
    showSaved = false,
  ) {
    await api(
      `/attempts/${encodeURIComponent(attemptId)}/questions/${encodeURIComponent(questionId)}/answer`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          selectedIds: answer.selectedIds,
          textAnswer: answer.textAnswer,
        }),
      },
    );
    if (showSaved && sectionRef.current === 'exams') {
      setMessage('Answer saved securely.');
    }
  }

  function queueSave(
    attemptId: string,
    questionId: string,
    answer: LocalAnswer,
    accessToken: string,
    showSaved = false,
  ) {
    const previous = saveChains.current[questionId] ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => persistAnswer(attemptId, questionId, answer, accessToken, showSaved));
    saveChains.current[questionId] = next;
    void next.catch((cause) => {
      setError(cause instanceof Error ? `Autosave failed: ${cause.message}` : 'Autosave failed.');
    }).finally(() => {
      if (saveChains.current[questionId] === next) {
        delete saveChains.current[questionId];
      }
    });
    return next;
  }

  function updateAnswer(questionId: string, next: LocalAnswer) {
    if (!attempt || !session) return;
    setAnswers((previous) => ({ ...previous, [questionId]: next }));
    const oldTimer = saveTimers.current[questionId];
    if (oldTimer) clearTimeout(oldTimer);
    const attemptId = attempt.id;
    const accessToken = session.accessToken;
    saveTimers.current[questionId] = setTimeout(() => {
      void queueSave(attemptId, questionId, next, accessToken, true);
      delete saveTimers.current[questionId];
    }, 400);
  }

  async function submitAttempt(automatic = false) {
    if (!attempt || !session || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      for (const timer of Object.values(saveTimers.current)) clearTimeout(timer);
      saveTimers.current = {};
      if (!automatic && Date.now() + serverOffset < new Date(attempt.deadlineAt).getTime()) {
        await Promise.all(
          attempt.exam.questions.map((question) =>
            queueSave(
              attempt.id,
              question.id,
              answers[question.id] ?? { selectedIds: [], textAnswer: '', isFlagged: false },
              session.accessToken,
            ),
          ),
        );
      }
      const result = await api<{ status: string; submissionReason: string }>(
        `/attempts/${encodeURIComponent(attempt.id)}/submit`,
        session.accessToken,
        { method: 'POST', body: '{}' },
      );
      setMessage(
        automatic
          ? 'Time expired. Your examination was automatically submitted by the server.'
          : `Examination submitted. Status: ${result.status}.`,
      );
      setAttempt(null);
      setConfirmSubmit(false);
      await loadDashboard(session);
      setSection('history');
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Unable to submit examination.';
      setError(detail);
      if (automatic) {
        const latest = await loadDashboard(session);
        if (latest && !latest.exams.some((exam) => exam.state === 'ONGOING')) {
          setAttempt(null);
          setSection('history');
          setMessage('The server finalized your attempt when the deadline expired.');
        }
      }
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  useEffect(() => {
    if (
      attempt &&
      seconds === 0 &&
      Date.now() + serverOffset >= new Date(attempt.deadlineAt).getTime() &&
      !submitting.current
    ) {
      void submitAttempt(true);
    }
  }, [seconds, attempt, serverOffset]);

  async function flagQuestion(questionId: string) {
    if (!attempt || !session) return;
    const next = {
      ...(answers[questionId] ?? { selectedIds: [], textAnswer: '', isFlagged: false }),
      isFlagged: !answers[questionId]?.isFlagged,
    };
    setAnswers((previous) => ({ ...previous, [questionId]: next }));
    try {
      await api(
        `/attempts/${encodeURIComponent(attempt.id)}/questions/${encodeURIComponent(questionId)}/flag`,
        session.accessToken,
        { method: 'POST', body: JSON.stringify({ flagged: next.isFlagged }) },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save question flag.');
    }
  }

  async function logout() {
    for (const timer of Object.values(saveTimers.current)) clearTimeout(timer);
    window.localStorage.removeItem('oes_student_session');
    window.location.assign('/');
  }

  const cards = [
    { label: 'Available exams', value: dashboard?.stats.availableExams, detail: 'Open for you now', color: 'text-emerald-700' },
    { label: 'Upcoming exams', value: dashboard?.stats.upcomingExams, detail: 'Scheduled to open', color: 'text-amber-700' },
    { label: 'Ongoing attempts', value: dashboard?.stats.ongoingAttempts, detail: 'Resume where you left off', color: 'text-blue-700' },
    { label: 'Completed exams', value: dashboard?.stats.completedExams, detail: 'Submitted or evaluated', color: 'text-violet-700' },
    { label: 'Published results', value: dashboard?.stats.publishedResults, detail: 'Marks and feedback available', color: 'text-slate-950' },
  ];

  if (!sessionReady) {
    return <main className="grid min-h-screen place-items-center text-slate-500">Loading student workspace...</main>;
  }
  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-5 text-center text-white">
        <section className="max-w-md rounded-3xl border border-white/10 bg-white/5 p-9 shadow-2xl">
          <div className="text-xs font-semibold uppercase tracking-[.25em] text-cyan-300">OES Student</div>
          <h1 className="mt-4 text-3xl font-bold">Student sign-in required</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">Sign in with an active student account to view eligible examinations and results.</p>
          <a href="/" className="mt-7 inline-flex rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950">Go to sign in</a>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-5 md:px-8">
          <div className="flex items-center gap-4"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-400 font-black text-slate-950">O</div><div><div className="text-[11px] font-semibold uppercase tracking-[.24em] text-cyan-300">Online Examination System</div><h1 className="mt-1 text-xl font-bold">Student workspace</h1></div></div>
          <div className="flex items-center gap-4"><div className="hidden text-right sm:block"><div className="text-sm font-semibold">{session.user.name}</div><div className="text-xs text-slate-400">{session.user.email}</div></div><button onClick={() => void logout()} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:bg-slate-800">Sign out</button></div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-5 py-8 md:px-8">
        {attempt ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
              <div><div className="text-sm font-semibold text-blue-700">ACTIVE EXAMINATION</div><h2 className="mt-1 text-2xl font-bold">{attempt.exam.title}</h2><p className="mt-1 text-sm text-slate-500">{attempt.exam.instructions}</p><p className="mt-2 text-xs text-slate-400">Answers autosave to the server; you can safely refresh to resume.</p></div>
              <div className={`rounded-2xl px-5 py-3 text-center ${seconds < 300 ? 'bg-rose-50 text-rose-700' : 'bg-slate-900 text-white'}`}><div className="text-xs uppercase tracking-wider">Time remaining</div><div aria-live="polite" className="font-mono text-2xl font-bold">{timeLabel}</div></div>
            </div>
            <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_260px]">
              <div>
                {activeQuestion && <><div className="flex items-center justify-between text-sm text-slate-500"><span>Question {current + 1} of {attempt.exam.questions.length}</span><span>{activeQuestion.marks} marks</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${((current + 1) / attempt.exam.questions.length) * 100}%` }} /></div>
                  <article className="mt-6 rounded-2xl border border-slate-200 p-5 md:p-7"><div className="text-xs font-bold uppercase tracking-widest text-slate-400">{activeQuestion.type.replace('_', ' ')}</div><h3 className="mt-3 text-xl font-semibold leading-8">{activeQuestion.prompt}</h3>
                    {activeQuestion.type === 'DESCRIPTIVE' ? (
                      <textarea aria-label="Your answer" value={answers[activeQuestion.id]?.textAnswer ?? ''} onChange={(event) => updateAnswer(activeQuestion.id, { ...(answers[activeQuestion.id] ?? { selectedIds: [], isFlagged: false }), textAnswer: event.target.value })} rows={8} placeholder="Write your answer here. It autosaves as you type." className="mt-6 w-full rounded-xl border border-slate-200 p-4 outline-none focus:border-blue-500" />
                    ) : (
                      <div className="mt-5 space-y-3">{activeQuestion.options.map((option) => { const selected = answers[activeQuestion.id]?.selectedIds.includes(option.id) ?? false; const multi = activeQuestion.type === 'MULTIPLE_SELECT'; return <label key={option.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${selected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}><input type={multi ? 'checkbox' : 'radio'} name={activeQuestion.id} checked={selected} onChange={() => { const old = answers[activeQuestion.id] ?? { selectedIds: [], textAnswer: '', isFlagged: false }; const ids = multi ? (selected ? old.selectedIds.filter((id) => id !== option.id) : [...old.selectedIds, option.id]) : [option.id]; updateAnswer(activeQuestion.id, { ...old, selectedIds: ids }); }} /><span>{option.text}</span></label>; })}</div>
                    )}
                    <button onClick={() => void flagQuestion(activeQuestion.id)} className={`mt-5 rounded-lg px-3 py-2 text-sm font-medium ${answers[activeQuestion.id]?.isFlagged ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{answers[activeQuestion.id]?.isFlagged ? '★ Flagged for review' : '☆ Flag for review'}</button>
                  </article>
                  <div className="mt-5 flex justify-between"><button disabled={current === 0} onClick={() => setCurrent((value) => value - 1)} className="rounded-xl border px-5 py-3 disabled:opacity-30">← Previous</button><button disabled={current >= attempt.exam.questions.length - 1} onClick={() => setCurrent((value) => value + 1)} className="rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-30">Next →</button></div>
                </>}
              </div>
              <aside><div className="rounded-2xl bg-slate-50 p-4"><h3 className="font-semibold">Question palette</h3><div className="mt-3 grid grid-cols-5 gap-2">{attempt.exam.questions.map((question, index) => { const answer = answers[question.id]; const hasAnswer = !!answer && (answer.selectedIds.length > 0 || answer.textAnswer.trim().length > 0); return <button key={question.id} aria-label={`Go to question ${index + 1}`} onClick={() => setCurrent(index)} className={`relative h-10 rounded-lg border text-sm font-semibold ${index === current ? 'border-blue-700 bg-blue-700 text-white' : answer?.isFlagged ? 'border-amber-400 bg-amber-100' : hasAnswer ? 'border-green-300 bg-green-100 text-green-800' : 'border-slate-200 bg-white'}`}>{index + 1}</button>; })}</div><div className="mt-5 space-y-2 text-sm text-slate-600"><div className="flex justify-between"><span>Answered</span><b>{answeredCount}</b></div><div className="flex justify-between"><span>Unanswered</span><b>{attempt.exam.questions.length - answeredCount}</b></div><div className="flex justify-between"><span>Flagged</span><b>{flaggedCount}</b></div></div><button disabled={busy} onClick={() => setConfirmSubmit(true)} className="mt-5 w-full rounded-xl bg-rose-600 px-4 py-3 font-semibold text-white hover:bg-rose-700 disabled:opacity-50">Submit examination</button></div><p className="mt-3 text-xs leading-5 text-slate-400">The server enforces the deadline and automatically submits when time expires.</p></aside>
            </div>
          </section>
        ) : (
          <>
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="text-sm font-semibold text-blue-700">STUDENT PORTAL</div><h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Hello, {session.user.name.split(' ')[0]}.</h2><p className="mt-2 text-sm text-slate-500">Your examinations, progress, and published results in one place.</p></div><button onClick={() => void refreshDashboard()} disabled={loading} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">{loading ? 'Refreshing...' : 'Refresh dashboard'}</button></div>
            {(error || message) && <div role="status" className={`mb-6 flex justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-blue-200 bg-blue-50 text-blue-900'}`}><span>{error || message}</span><button onClick={() => { setError(''); setMessage(''); }} aria-label="Dismiss message" className="font-bold">×</button></div>}
            <nav aria-label="Student sections" className="mb-6 flex flex-wrap gap-2">{(['overview', 'exams', 'history', 'results'] as const).map((item) => <button key={item} onClick={() => setSection(item)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold capitalize ${section === item ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>{item === 'history' ? 'Exam history' : item === 'results' ? `Results (${results.length})` : item}</button>)}</nav>

            {section === 'overview' && <>
              <section aria-label="Student statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{cards.map((card) => <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm font-medium text-slate-500">{card.label}</div><div className={`mt-3 text-3xl font-bold ${card.color}`}>{card.value ?? '—'}</div><div className="mt-2 text-xs text-slate-500">{card.detail}</div></article>)}</section>
              {ongoing.length > 0 && <section className="mt-7 rounded-2xl border border-blue-200 bg-blue-50 p-5"><h3 className="font-bold text-blue-950">Continue your attempt</h3><div className="mt-3 flex flex-wrap gap-3">{ongoing.map((exam) => <button key={exam.id} onClick={() => exam.attempt && void openAttempt(exam.attempt.id)} className="rounded-xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white">{exam.title} · Resume</button>)}</div></section>}
              <section className="mt-7 rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-5"><div><h3 className="font-bold text-slate-950">Examinations for you</h3><p className="mt-1 text-xs text-slate-500">Availability is determined by the examination schedule and eligibility.</p></div><button onClick={() => setSection('exams')} className="text-sm font-semibold text-blue-700">View all →</button></div><div className="divide-y divide-slate-100">{(dashboard?.exams ?? []).slice(0, 5).map((exam) => <ExamRow key={exam.id} exam={exam} onStart={startExam} onResume={(id) => void openAttempt(id)} />)}{!dashboard?.exams.length && <p className="p-8 text-center text-sm text-slate-500">No examinations are available yet.</p>}</div></section>
            </>}

            {section === 'exams' && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-5"><h3 className="font-bold">Eligible examinations</h3><p className="mt-1 text-sm text-slate-500">Upcoming, available, ongoing, and recently completed exams.</p></div><div className="divide-y divide-slate-100">{(dashboard?.exams ?? []).map((exam) => <ExamRow key={exam.id} exam={exam} onStart={startExam} onResume={(id) => void openAttempt(id)} />)}{!dashboard?.exams.length && <p className="p-10 text-center text-sm text-slate-500">No examinations are currently available.</p>}</div></section>}

            {section === 'history' && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-5"><h3 className="font-bold">Examination history</h3><p className="mt-1 text-sm text-slate-500">Your completed submissions and active attempts. Unpublished scores are not shown.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[750px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-4">Examination</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Submission</th><th className="px-5 py-4">Published score</th><th className="px-5 py-4">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{(dashboard?.exams ?? []).filter((exam) => exam.attempt).map((exam) => <tr key={exam.id}><td className="px-5 py-4"><div className="font-semibold">{exam.title}</div><div className="mt-1 text-xs text-slate-500">{exam.subject}</div></td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${stateClass(exam.state)}`}>{exam.attempt?.status.replace('_', ' ')}</span></td><td className="px-5 py-4 text-xs text-slate-600">{exam.attempt?.submittedAt ? formatDate(exam.attempt.submittedAt) : exam.attempt?.status === 'IN_PROGRESS' ? 'In progress' : '—'}</td><td className="px-5 py-4">{exam.attempt?.result ? `${exam.attempt.result.totalMarks ?? '—'} / ${exam.maxMarks}` : <span className="text-xs text-slate-400">Not published</span>}</td><td className="px-5 py-4">{exam.state === 'ONGOING' && exam.attempt && <button onClick={() => void openAttempt(exam.attempt!.id)} className="text-sm font-semibold text-blue-700">Resume</button>}</td></tr>)}{!dashboard?.exams.some((exam) => exam.attempt) && <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-500">No examination history yet.</td></tr>}</tbody></table></div></section>}

            {section === 'results' && <section className="space-y-4"><div className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-bold">Published results</h3><p className="mt-1 text-sm text-slate-500">Marks and faculty feedback appear here only after your result is published.</p></div>{results.map((result) => <article key={result.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-bold">{result.attempt.exam.title}</h3><p className="mt-1 text-sm text-slate-500">{result.attempt.exam.subject} · Published {result.publishedAt ? formatDate(result.publishedAt) : ''}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${result.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{result.passed ? 'PASSED' : 'NOT PASSED'}</span></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3 text-sm">Objective <b className="float-right">{result.objectiveMarks}</b></div><div className="rounded-xl bg-slate-50 p-3 text-sm">Descriptive <b className="float-right">{result.descriptiveMarks ?? 0}</b></div><div className="rounded-xl bg-blue-50 p-3 text-sm">Total <b className="float-right">{result.totalMarks} / {result.attempt.exam.maxMarks}</b></div></div><div className="mt-4 space-y-3">{result.attempt.answers.map((answer) => <div key={answer.questionId} className="rounded-xl border border-slate-100 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><div className="font-semibold">Question {answer.question.position}: {answer.question.prompt}</div><span className="text-xs font-semibold text-slate-600">{answer.awardedMarks ?? 0} / {answer.question.marks} marks</span></div>{answer.feedback && <p className="mt-2 text-slate-600">{answer.feedback}</p>}</div>)}</div></article>)}{!results.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><h3 className="font-semibold">No results published yet</h3><p className="mt-2 text-sm text-slate-500">Your marks and feedback will appear after the faculty publishes your result.</p></div>}</section>}
          </>
        )}
      </div>

      {confirmSubmit && attempt && <div role="dialog" aria-modal="true" className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/60 p-5"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h3 className="text-xl font-bold">Submit examination?</h3><p className="mt-2 text-sm text-slate-600">Answered: {answeredCount} · Unanswered: {attempt.exam.questions.length - answeredCount} · Flagged: {flaggedCount}. Your answers will be saved before final submission.</p><div className="mt-6 flex justify-end gap-3"><button onClick={() => setConfirmSubmit(false)} className="rounded-xl border px-4 py-2">Return to exam</button><button disabled={busy} onClick={() => void submitAttempt(false)} className="rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Submitting...' : 'Confirm submit'}</button></div></div></div>}
    </main>
  );
}

function ExamRow({
  exam,
  onStart,
  onResume,
}: {
  exam: StudentExam;
  onStart: (exam: StudentExam) => void;
  onResume: (attemptId: string) => void;
}) {
  return (
    <article className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
      <div className="min-w-[250px] flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{exam.subject}</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${stateClass(exam.state)}`}>{exam.state.replace('_', ' ')}</span></div>
        <h3 className="mt-3 font-bold text-slate-950">{exam.title}</h3>
        <p className="mt-1 text-sm text-slate-500">{exam.instructions}</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500"><span>{exam.durationMinutes} min</span><span>{exam.questionCount} questions</span><span>{exam.maxMarks} marks</span><span>Opens {formatDate(exam.opensAt)}</span><span>Closes {formatDate(exam.closesAt)}</span></div>
        {exam.attempt?.result && <p className="mt-2 text-sm font-semibold text-emerald-700">Published score: {exam.attempt.result.totalMarks} / {exam.maxMarks}</p>}
      </div>
      <div>
        {exam.state === 'AVAILABLE' && <button onClick={() => onStart(exam)} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800">Read instructions & start</button>}
        {exam.state === 'ONGOING' && exam.attempt && <button onClick={() => onResume(exam.attempt!.id)} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800">Resume attempt</button>}
        {exam.state === 'UPCOMING' && <span className="text-sm text-slate-500">Available at scheduled time</span>}
        {exam.state === 'COMPLETED' && <span className="text-sm text-slate-500">{exam.attempt?.result ? 'Result published' : 'Submitted · result pending'}</span>}
        {exam.state === 'CLOSED' && <span className="text-sm text-slate-500">Examination closed</span>}
      </div>
    </article>
  );
}
