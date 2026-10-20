'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

type FacultySession = {
  accessToken: string;
  user: { id: string; name: string; email: string; role: 'FACULTY' };
};
type QuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_SELECT' | 'DESCRIPTIVE';
type ExamStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
type ExamOption = { id: string; text: string; isCorrect: boolean; position: number };
type Question = {
  id: string;
  prompt: string;
  type: QuestionType;
  marks: number;
  negativeMarks: number;
  position: number;
  options: ExamOption[];
};
type Exam = {
  id: string;
  title: string;
  subject: string;
  instructions: string;
  status: ExamStatus;
  durationMinutes: number;
  opensAt: string;
  closesAt: string;
  maxMarks: number;
  passMarks: number;
  negativeMarking: boolean;
  negativeMarkValue: number;
  questions: Question[];
  _count: { attempts: number; questions?: number };
};
type FacultyStats = {
  totalExams: number;
  draftExams: number;
  publishedExams: number;
  upcomingExams: number;
  studentAttempts: number;
  submissionsAwaitingEvaluation: number;
};
type Answer = {
  id: string;
  questionId: string;
  selectedIds: string[];
  textAnswer: string | null;
  awardedMarks: number | null;
  feedback: string | null;
  question: Question;
};
type Attempt = {
  id: string;
  status: string;
  startedAt: string;
  submittedAt: string | null;
  submissionReason: string | null;
  student: { id: string; name: string; email: string };
  exam: { id: string; title: string; subject: string; maxMarks: number; passMarks: number; questions: Question[] };
  answers: Answer[];
  result: {
    id: string;
    objectiveMarks: number;
    descriptiveMarks: number | null;
    totalMarks: number | null;
    status: string;
    passed: boolean | null;
  } | null;
};
type EditorQuestion = {
  key: string;
  prompt: string;
  type: QuestionType;
  marks: string;
  negativeMarks: string;
  options: { key: string; text: string; isCorrect: boolean }[];
};
type Editor = {
  id?: string;
  title: string;
  subject: string;
  instructions: string;
  durationMinutes: string;
  opensAt: string;
  closesAt: string;
  maxMarks: string;
  passMarks: string;
  negativeMarking: boolean;
  negativeMarkValue: string;
  questions: EditorQuestion[];
};

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

function localDateValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function newQuestion(type: QuestionType = 'SINGLE_CHOICE'): EditorQuestion {
  const key = `${Date.now()}-${Math.random()}`;
  return {
    key,
    prompt: '',
    type,
    marks: '1',
    negativeMarks: '0',
    options:
      type === 'DESCRIPTIVE'
        ? []
        : [
            { key: `${key}-a`, text: '', isCorrect: true },
            { key: `${key}-b`, text: '', isCorrect: false },
          ],
  };
}

function emptyEditor(): Editor {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    title: '',
    subject: '',
    instructions: '',
    durationMinutes: '60',
    opensAt: localDateValue(start),
    closesAt: localDateValue(end),
    maxMarks: '1',
    passMarks: '0',
    negativeMarking: false,
    negativeMarkValue: '0',
    questions: [newQuestion()],
  };
}

function examToEditor(exam: Exam): Editor {
  return {
    id: exam.id,
    title: exam.title,
    subject: exam.subject,
    instructions: exam.instructions,
    durationMinutes: String(exam.durationMinutes),
    opensAt: localDateValue(new Date(exam.opensAt)),
    closesAt: localDateValue(new Date(exam.closesAt)),
    maxMarks: String(exam.maxMarks),
    passMarks: String(exam.passMarks),
    negativeMarking: exam.negativeMarking,
    negativeMarkValue: String(exam.negativeMarkValue),
    questions: exam.questions.map((question) => ({
      key: question.id,
      prompt: question.prompt,
      type: question.type,
      marks: String(question.marks),
      negativeMarks: String(question.negativeMarks),
      options: question.options.map((option) => ({
        key: option.id,
        text: option.text,
        isCorrect: option.isCorrect,
      })),
    })),
  };
}

function statusClass(status: string) {
  if (status === 'PUBLISHED' || status === 'EVALUATED') return 'bg-emerald-50 text-emerald-700';
  if (status === 'DRAFT' || status === 'SUBMITTED' || status === 'PENDING_EVALUATION') return 'bg-amber-50 text-amber-800';
  return 'bg-slate-100 text-slate-600';
}

export default function FacultyPage() {
  const [session, setSession] = useState<FacultySession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [stats, setStats] = useState<FacultyStats | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [panel, setPanel] = useState<'dashboard' | 'exams' | 'submissions'>('dashboard');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [preview, setPreview] = useState(false);
  const [selectedAttemptId, setSelectedAttemptId] = useState('');
  const [grades, setGrades] = useState<Record<string, { marks: string; feedback: string }>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem('oes_faculty_session');
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
          value.user.role === 'FACULTY'
        ) {
          setSession(value as FacultySession);
        } else {
          window.localStorage.removeItem('oes_faculty_session');
        }
      } catch {
        window.localStorage.removeItem('oes_faculty_session');
      }
    }
    setSessionReady(true);
  }, []);

  async function loadData(activeSession: FacultySession) {
    setLoading(true);
    setError('');
    try {
      const [dashboard, nextAttempts] = await Promise.all([
        api<{ stats: FacultyStats; exams: Exam[] }>('/faculty/dashboard', activeSession.accessToken),
        api<Attempt[]>('/faculty/attempts', activeSession.accessToken),
      ]);
      setStats(dashboard.stats);
      setExams(dashboard.exams);
      setAttempts(nextAttempts);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to load faculty data.';
      setError(message);
      if (
        message.includes('Insufficient role permissions') ||
        message.includes('active, verified faculty') ||
        message.includes('Invalid or expired') ||
        message.includes('required')
      ) {
        window.localStorage.removeItem('oes_faculty_session');
        setSession(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session) void loadData(session);
  }, [session]);

  const selectedAttempt = useMemo(
    () => attempts.find((attempt) => attempt.id === selectedAttemptId) ?? null,
    [attempts, selectedAttemptId],
  );
  const questionMarkTotal = editor?.questions.reduce(
    (sum, question) => sum + (Number(question.marks) || 0),
    0,
  ) ?? 0;
  const pendingAttempts = attempts.filter(
    (attempt) => attempt.result?.status === 'PENDING_EVALUATION',
  );

  function openNewExam() {
    setEditor(emptyEditor());
    setPreview(false);
    setPanel('exams');
    setError('');
  }

  function openExam(exam: Exam) {
    setEditor(examToEditor(exam));
    setPreview(false);
    setPanel('exams');
    setError('');
  }

  async function saveExam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !editor) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        title: editor.title,
        subject: editor.subject,
        instructions: editor.instructions,
        durationMinutes: Number(editor.durationMinutes),
        opensAt: new Date(editor.opensAt).toISOString(),
        closesAt: new Date(editor.closesAt).toISOString(),
        maxMarks: Number(editor.maxMarks),
        passMarks: Number(editor.passMarks),
        negativeMarking: editor.negativeMarking,
        negativeMarkValue: Number(editor.negativeMarkValue),
        questions: editor.questions.map((question) => ({
          prompt: question.prompt,
          type: question.type,
          marks: Number(question.marks),
          negativeMarks: Number(question.negativeMarks) || 0,
          options: question.options.map(({ text, isCorrect }) => ({ text, isCorrect })),
        })),
      };
      const path = editor.id
        ? `/faculty/exams/${encodeURIComponent(editor.id)}`
        : '/faculty/exams';
      const result = await api<Exam>(path, session.accessToken, {
        method: editor.id ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      setEditor(examToEditor(result));
      setNotice('Draft saved to the database.');
      await loadData(session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save examination.');
    } finally {
      setBusy(false);
    }
  }

  async function examAction(exam: Exam, action: 'publish' | 'close' | 'delete') {
    if (!session) return;
    if (
      action !== 'publish' &&
      !window.confirm(
        action === 'close'
          ? `Close "${exam.title}"? Students will no longer be able to start it.`
          : `Delete draft "${exam.title}"? This cannot be undone.`,
      )
    ) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(
        `/faculty/exams/${encodeURIComponent(exam.id)}${action === 'delete' ? '' : `/${action}`}`,
        session.accessToken,
        { method: action === 'delete' ? 'DELETE' : 'PATCH' },
      );
      if (editor?.id === exam.id) setEditor(null);
      setNotice(
        action === 'publish'
          ? 'Examination published.'
          : action === 'close'
            ? 'Examination closed.'
            : 'Draft examination deleted.',
      );
      await loadData(session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update examination.');
    } finally {
      setBusy(false);
    }
  }

  function chooseAttempt(attempt: Attempt) {
    setSelectedAttemptId(attempt.id);
    const next: Record<string, { marks: string; feedback: string }> = {};
    for (const question of attempt.exam.questions) {
      if (question.type !== 'DESCRIPTIVE') continue;
      const answer = attempt.answers.find((item) => item.questionId === question.id);
      next[question.id] = {
        marks: String(answer?.awardedMarks ?? 0),
        feedback: answer?.feedback ?? '',
      };
    }
    setGrades(next);
  }

  async function saveEvaluation() {
    if (!session || !selectedAttempt) return;
    const questionIds = new Set<string>();
    for (const question of selectedAttempt.exam.questions) {
      if (question.type === 'DESCRIPTIVE') questionIds.add(question.id);
    }
    if (!questionIds.size) {
      setError('This submission has no descriptive questions to evaluate.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api<{ id: string; totalMarks: number }>(
        `/faculty/attempts/${encodeURIComponent(selectedAttempt.id)}/evaluate`,
        session.accessToken,
        {
          method: 'PATCH',
          body: JSON.stringify({
            answers: [...questionIds].map((questionId) => ({
              questionId,
              awardedMarks: Number(grades[questionId]?.marks ?? 0),
              feedback: grades[questionId]?.feedback ?? '',
            })),
          }),
        },
      );
      setNotice(`Evaluation saved. Final score: ${result.totalMarks} / ${selectedAttempt.exam.maxMarks}.`);
      await loadData(session);
      setSelectedAttemptId(selectedAttempt.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to evaluate submission.');
    } finally {
      setBusy(false);
    }
  }

  async function publishResult(attempt: Attempt) {
    if (!session || !attempt.result) return;
    setBusy(true);
    setError('');
    try {
      await api(`/results/${encodeURIComponent(attempt.result.id)}/publish`, session.accessToken, { method: 'POST' });
      setNotice(`Result published for ${attempt.student.name}.`);
      await loadData(session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to publish result.');
    } finally {
      setBusy(false);
    }
  }

  function updateQuestion(questionIndex: number, update: Partial<EditorQuestion>) {
    setEditor((current) => current
      ? {
          ...current,
          questions: current.questions.map((question, index) =>
            index === questionIndex ? { ...question, ...update } : question,
          ),
        }
      : current);
  }

  function logout() {
    window.localStorage.removeItem('oes_faculty_session');
    window.location.assign('/');
  }

  if (!sessionReady) {
    return <main className="grid min-h-screen place-items-center text-slate-500">Loading faculty workspace...</main>;
  }
  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-5 text-center text-white">
        <section className="max-w-md rounded-3xl border border-white/10 bg-white/5 p-9 shadow-2xl">
          <div className="text-xs font-semibold uppercase tracking-[.25em] text-cyan-300">OES Faculty</div>
          <h1 className="mt-4 text-3xl font-bold">Verified faculty sign-in required</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">Sign in with an active faculty account approved by an administrator.</p>
          <a href="/" className="mt-7 inline-flex rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950">Go to sign in</a>
        </section>
      </main>
    );
  }

  const metrics = stats
    ? [
        { label: 'Total examinations', value: stats.totalExams, detail: 'Your examinations', color: 'text-slate-950' },
        { label: 'Draft exams', value: stats.draftExams, detail: 'Saved, not published', color: 'text-amber-700' },
        { label: 'Published exams', value: stats.publishedExams, detail: 'Currently available', color: 'text-emerald-700' },
        { label: 'Upcoming exams', value: stats.upcomingExams, detail: 'Scheduled to open', color: 'text-blue-700' },
        { label: 'Student attempts', value: stats.studentAttempts, detail: 'Across your exams', color: 'text-violet-700' },
        { label: 'Awaiting evaluation', value: stats.submissionsAwaitingEvaluation, detail: 'Descriptive answers', color: 'text-rose-700' },
      ]
    : [];

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-5 md:px-8">
          <div className="flex items-center gap-4">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-400 font-black text-slate-950">O</div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.24em] text-cyan-300">Online Examination System</div>
              <h1 className="mt-1 text-xl font-bold">Faculty workspace</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold">{session.user.name}</div>
              <div className="text-xs text-slate-400">{session.user.email}</div>
            </div>
            <button onClick={logout} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:bg-slate-800">Sign out</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-5 py-8 md:px-8">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-blue-700">FACULTY PORTAL</div>
            <h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
              {panel === 'dashboard' ? 'Dashboard' : panel === 'exams' ? 'Examinations' : 'Submissions'}
            </h2>
            <p className="mt-2 text-sm text-slate-500">Create assessments, follow student progress, and publish evaluated results.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setPanel('dashboard'); setEditor(null); }} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${panel === 'dashboard' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Dashboard</button>
            <button onClick={() => { setPanel('exams'); setEditor(null); }} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${panel === 'exams' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Examinations</button>
            <button onClick={() => { setPanel('submissions'); setEditor(null); }} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${panel === 'submissions' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Submissions <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5">{pendingAttempts.length}</span></button>
            <button onClick={() => session && void loadData(session)} disabled={loading} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">{loading ? 'Refreshing...' : 'Refresh'}</button>
          </div>
        </div>

        {(error || notice) && (
          <div role="status" className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            <span>{error || notice}</span>
            <button onClick={() => { setError(''); setNotice(''); }} aria-label="Dismiss message" className="font-bold">×</button>
          </div>
        )}

        {panel === 'dashboard' && (
          <>
            <section aria-label="Faculty statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {metrics.map((metric) => (
                <article key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-medium text-slate-500">{metric.label}</div>
                  <div className={`mt-3 text-3xl font-bold ${metric.color}`}>{stats ? metric.value : '—'}</div>
                  <div className="mt-2 text-xs text-slate-500">{metric.detail}</div>
                </article>
              ))}
            </section>
            <div className="mt-8 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5">
                  <div><h3 className="font-bold text-slate-950">Your examinations</h3><p className="mt-1 text-xs text-slate-500">Recent updates from the database</p></div>
                  <button onClick={openNewExam} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800">Create exam</button>
                </div>
                <div className="divide-y divide-slate-100">
                  {exams.slice(0, 6).map((exam) => (
                    <div key={exam.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                      <div><div className="font-semibold text-slate-900">{exam.title}</div><div className="mt-1 text-xs text-slate-500">{exam.subject} · {exam._count.attempts} attempts · {exam._count.questions ?? 0} questions</div></div>
                      <div className="flex items-center gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(exam.status)}`}>{exam.status}</span><button onClick={() => openExam(exam)} className="text-sm font-semibold text-blue-700 hover:text-blue-900">View / edit</button></div>
                    </div>
                  ))}
                  {!exams.length && <p className="p-8 text-center text-sm text-slate-500">No examinations yet. Create a draft to get started.</p>}
                </div>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-5"><h3 className="font-bold text-slate-950">Needs evaluation</h3><p className="mt-1 text-xs text-slate-500">Submitted examinations containing descriptive answers</p></div>
                <div className="divide-y divide-slate-100">
                  {pendingAttempts.slice(0, 6).map((attempt) => (
                    <button key={attempt.id} onClick={() => { setPanel('submissions'); chooseAttempt(attempt); }} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50">
                      <span><span className="block font-semibold text-slate-900">{attempt.student.name}</span><span className="mt-1 block text-xs text-slate-500">{attempt.exam.title}</span></span>
                      <span className="text-xs font-semibold text-amber-700">Review →</span>
                    </button>
                  ))}
                  {!pendingAttempts.length && <p className="p-8 text-center text-sm text-slate-500">No submissions awaiting evaluation.</p>}
                </div>
              </section>
            </div>
          </>
        )}

        {panel === 'exams' && !editor && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5">
              <div><h3 className="font-bold text-slate-950">Examination library</h3><p className="mt-1 text-sm text-slate-500">Only examinations created by your account are shown.</p></div>
              <button onClick={openNewExam} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white">Create examination</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-4">Examination</th><th className="px-5 py-4">Schedule</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Activity</th><th className="px-5 py-4 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {exams.map((exam) => (
                    <tr key={exam.id}>
                      <td className="px-5 py-4"><div className="font-semibold">{exam.title}</div><div className="mt-1 text-xs text-slate-500">{exam.subject} · {exam.maxMarks} marks · {exam.durationMinutes} minutes</div></td>
                      <td className="px-5 py-4 text-xs text-slate-600">{new Date(exam.opensAt).toLocaleString()}<div className="mt-1">to {new Date(exam.closesAt).toLocaleString()}</div></td>
                      <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(exam.status)}`}>{exam.status}</span></td>
                      <td className="px-5 py-4 text-xs text-slate-600">{exam._count.attempts} attempts · {exam._count.questions ?? 0} questions</td>
                      <td className="px-5 py-4"><div className="flex justify-end gap-2">
                        <button onClick={() => openExam(exam)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">View / edit</button>
                        {exam.status === 'DRAFT' && <><button onClick={() => void examAction(exam, 'publish')} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Publish</button><button onClick={() => void examAction(exam, 'delete')} disabled={busy} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50">Delete</button></>}
                        {exam.status === 'PUBLISHED' && <button onClick={() => void examAction(exam, 'close')} disabled={busy} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50">Close exam</button>}
                      </div></td>
                    </tr>
                  ))}
                  {!exams.length && <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-500">No examinations have been created.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {panel === 'exams' && editor && (
          <form onSubmit={saveExam} className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div><div className="text-xs font-bold uppercase tracking-wider text-blue-700">{editor.id ? 'EDIT EXAMINATION' : 'NEW DRAFT'}</div><h3 className="mt-1 text-xl font-bold">{editor.title || 'Examination details'}</h3></div>
                <div className="flex gap-2"><button type="button" onClick={() => setPreview(true)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Preview</button><button type="button" onClick={() => { setEditor(null); setPreview(false); }} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Back</button></div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label className="text-sm font-medium md:col-span-2">Exam title<input required maxLength={200} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-blue-500" /></label>
                <label className="text-sm font-medium">Subject<input required maxLength={200} value={editor.subject} onChange={(event) => setEditor({ ...editor, subject: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-blue-500" /></label>
                <label className="text-sm font-medium">Duration (minutes)<input required type="number" min="1" max="1440" value={editor.durationMinutes} onChange={(event) => setEditor({ ...editor, durationMinutes: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
                <label className="text-sm font-medium">Total marks<input required type="number" min="0.01" step="0.01" value={editor.maxMarks} onChange={(event) => setEditor({ ...editor, maxMarks: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
                <label className="text-sm font-medium">Passing marks<input required type="number" min="0" step="0.01" value={editor.passMarks} onChange={(event) => setEditor({ ...editor, passMarks: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
                <label className="text-sm font-medium">Starts at<input required type="datetime-local" value={editor.opensAt} onChange={(event) => setEditor({ ...editor, opensAt: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
                <label className="text-sm font-medium">Ends at<input required type="datetime-local" value={editor.closesAt} onChange={(event) => setEditor({ ...editor, closesAt: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
                <label className="text-sm font-medium md:col-span-2 xl:col-span-3">Instructions<textarea required maxLength={10000} rows={3} value={editor.instructions} onChange={(event) => setEditor({ ...editor, instructions: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
                <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={editor.negativeMarking} onChange={(event) => setEditor({ ...editor, negativeMarking: event.target.checked })} /> Enable negative marking</label>
                {editor.negativeMarking && <label className="text-sm font-medium">Default penalty<input type="number" min="0" step="0.01" value={editor.negativeMarkValue} onChange={(event) => setEditor({ ...editor, negativeMarkValue: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>}
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold">Questions</h3><p className={`mt-1 text-sm ${Math.round(questionMarkTotal * 100) === Math.round(Number(editor.maxMarks) * 100) ? 'text-emerald-700' : 'text-amber-700'}`}>Question marks: {questionMarkTotal.toFixed(2)} / {Number(editor.maxMarks || 0).toFixed(2)} total · totals must match to publish</p></div><button type="button" onClick={() => setEditor({ ...editor, questions: [...editor.questions, newQuestion()] })} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Add question</button></div>
              {editor.questions.map((question, index) => (
                <article key={question.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="font-bold">Question {index + 1}</h4>
                    <div className="flex gap-2">
                      <button type="button" disabled={index === 0} onClick={() => setEditor({ ...editor, questions: editor.questions.map((q, i, list) => i === index ? list[index - 1] : i === index - 1 ? list[index] : q) })} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">Move up</button>
                      <button type="button" disabled={index === editor.questions.length - 1} onClick={() => setEditor({ ...editor, questions: editor.questions.map((q, i, list) => i === index ? list[index + 1] : i === index + 1 ? list[index] : q) })} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">Move down</button>
                      <button type="button" onClick={() => setEditor({ ...editor, questions: editor.questions.filter((_, i) => i !== index) })} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-700">Delete</button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_190px_110px]">
                    <label className="text-sm font-medium">Prompt<textarea required rows={2} value={question.prompt} onChange={(event) => updateQuestion(index, { prompt: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
                    <label className="text-sm font-medium">Question type<select value={question.type} onChange={(event) => { const type = event.target.value as QuestionType; const existing = question.options.length ? question.options : [{ key: `${question.key}-a`, text: '', isCorrect: true }, { key: `${question.key}-b`, text: '', isCorrect: false }]; const options = type === 'DESCRIPTIVE' ? [] : type === 'SINGLE_CHOICE' ? existing.map((option, i) => ({ ...option, isCorrect: i === Math.max(0, existing.findIndex((item) => item.isCorrect)) })) : existing; updateQuestion(index, { type, options }); }} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"><option value="SINGLE_CHOICE">Single-choice MCQ</option><option value="MULTIPLE_SELECT">Multiple-select MCQ</option><option value="DESCRIPTIVE">Descriptive</option></select></label>
                    <label className="text-sm font-medium">Marks<input required type="number" min="0.01" step="0.01" value={question.marks} onChange={(event) => updateQuestion(index, { marks: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
                  </div>
                  {question.type !== 'DESCRIPTIVE' && (
                    <div className="mt-4 space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Answer options · mark the correct answer{question.type === 'MULTIPLE_SELECT' ? 's' : ''}</div>
                      {question.options.map((option, optionIndex) => (
                        <div key={option.key} className="flex items-center gap-3">
                          <input aria-label={`Option ${optionIndex + 1} correct`} type={question.type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox'} checked={option.isCorrect} onChange={() => updateQuestion(index, { options: question.options.map((item, i) => ({ ...item, isCorrect: question.type === 'SINGLE_CHOICE' ? i === optionIndex : i === optionIndex ? !item.isCorrect : item.isCorrect })) })} />
                          <input required maxLength={500} value={option.text} placeholder={`Option ${optionIndex + 1}`} onChange={(event) => updateQuestion(index, { options: question.options.map((item, i) => i === optionIndex ? { ...item, text: event.target.value } : item) })} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                          <button type="button" disabled={question.options.length <= 2} onClick={() => updateQuestion(index, { options: question.options.filter((_, i) => i !== optionIndex) })} className="text-xs text-rose-700 disabled:opacity-40">Remove</button>
                        </div>
                      ))}
                      <button type="button" disabled={question.options.length >= 20} onClick={() => updateQuestion(index, { options: [...question.options, { key: `${question.key}-${Date.now()}`, text: '', isCorrect: false }] })} className="text-sm font-semibold text-blue-700 disabled:opacity-40">+ Add option</button>
                    </div>
                  )}
                  {editor.negativeMarking && question.type !== 'DESCRIPTIVE' && <label className="mt-4 block max-w-xs text-sm font-medium">Question penalty override (0 uses default)<input type="number" min="0" step="0.01" value={question.negativeMarks} onChange={(event) => updateQuestion(index, { negativeMarks: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>}
                </article>
              ))}
              {!editor.questions.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Add at least one question before publishing.</div>}
            </section>
            <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-slate-50/95 py-4 backdrop-blur">
              <button type="button" onClick={() => setPreview(true)} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold">Preview</button>
              <button type="submit" disabled={busy} className="rounded-xl bg-blue-700 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save draft'}</button>
            </div>
          </form>
        )}

        {panel === 'submissions' && (
          <div className="grid gap-6 xl:grid-cols-[minmax(320px,.8fr)_minmax(0,1.5fr)]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-5"><h3 className="font-bold">Student attempts</h3><p className="mt-1 text-xs text-slate-500">{attempts.length} attempts for your examinations</p></div>
              <div className="max-h-[720px] divide-y divide-slate-100 overflow-y-auto">
                {attempts.map((attempt) => (
                  <button key={attempt.id} onClick={() => chooseAttempt(attempt)} className={`w-full px-5 py-4 text-left hover:bg-slate-50 ${selectedAttemptId === attempt.id ? 'bg-blue-50' : ''}`}>
                    <div className="flex items-center justify-between gap-2"><span className="font-semibold">{attempt.student.name}</span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass(attempt.result?.status ?? attempt.status)}`}>{attempt.result?.status ?? attempt.status}</span></div>
                    <div className="mt-1 text-xs text-slate-500">{attempt.exam.title}</div>
                    <div className="mt-2 text-xs text-slate-500">{attempt.submittedAt ? `Submitted ${new Date(attempt.submittedAt).toLocaleString()}` : `Started ${new Date(attempt.startedAt).toLocaleString()}`}</div>
                  </button>
                ))}
                {!attempts.length && <p className="p-8 text-center text-sm text-slate-500">No student attempts yet.</p>}
              </div>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              {!selectedAttempt ? <div className="p-12 text-center text-sm text-slate-500">Select an attempt to inspect answers and evaluation status.</div> : (
                <>
                  <div className="border-b border-slate-100 px-5 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><h3 className="text-lg font-bold">{selectedAttempt.student.name}</h3><p className="mt-1 text-sm text-slate-500">{selectedAttempt.student.email} · {selectedAttempt.exam.title}</p></div>
                      {selectedAttempt.result && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(selectedAttempt.result.status)}`}>{selectedAttempt.result.status}</span>}
                    </div>
                    {selectedAttempt.result && <div className="mt-4 flex flex-wrap gap-4 rounded-xl bg-slate-50 p-3 text-sm"><span>MCQ: <b>{selectedAttempt.result.objectiveMarks}</b></span><span>Descriptive: <b>{selectedAttempt.result.descriptiveMarks ?? 'Pending'}</b></span><span>Total: <b>{selectedAttempt.result.totalMarks ?? 'Pending'} / {selectedAttempt.exam.maxMarks}</b></span><span>Pass mark: <b>{selectedAttempt.exam.passMarks}</b></span></div>}
                  </div>
                  <div className="space-y-4 p-5">
                    {[...selectedAttempt.answers].sort((a, b) => a.question.position - b.question.position).map((answer) => (
                      <article key={answer.id} className="rounded-xl border border-slate-200 p-4">
                        <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{answer.question.position}. {answer.question.prompt}</span><span className="text-xs text-slate-500">{answer.awardedMarks ?? '—'} / {answer.question.marks} marks</span></div>
                        {answer.question.type === 'DESCRIPTIVE' ? (
                          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm whitespace-pre-wrap">{answer.textAnswer || <span className="italic text-slate-400">No answer submitted</span>}</div>
                        ) : (
                          <div className="mt-3 space-y-1 text-sm">
                            {answer.question.options.map((option) => (
                              <div key={option.id} className={`flex items-center gap-2 ${option.isCorrect ? 'font-semibold text-emerald-700' : 'text-slate-600'}`}>
                                <span>{answer.selectedIds.includes(option.id) ? '●' : '○'}</span><span>{option.text}</span>{option.isCorrect && <span className="text-xs">(correct)</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {answer.question.type === 'DESCRIPTIVE' && selectedAttempt.result?.status === 'PENDING_EVALUATION' && (
                          <div className="mt-3 grid gap-3 md:grid-cols-[130px_1fr]">
                            <label className="text-xs font-semibold">Awarded marks<input type="number" min="0" max={answer.question.marks} step="0.01" value={grades[answer.questionId]?.marks ?? '0'} onChange={(event) => setGrades({ ...grades, [answer.questionId]: { ...(grades[answer.questionId] ?? { feedback: '' }), marks: event.target.value } })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
                            <label className="text-xs font-semibold">Feedback<input value={grades[answer.questionId]?.feedback ?? ''} onChange={(event) => setGrades({ ...grades, [answer.questionId]: { ...(grades[answer.questionId] ?? { marks: '0' }), feedback: event.target.value } })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
                          </div>
                        )}
                        {answer.feedback && <p className="mt-3 text-sm text-slate-600"><b>Feedback:</b> {answer.feedback}</p>}
                      </article>
                    ))}
                    {selectedAttempt.result?.status === 'PENDING_EVALUATION' && (
                      <button onClick={() => void saveEvaluation()} disabled={busy} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save evaluation'}</button>
                    )}
                    {selectedAttempt.result?.status === 'EVALUATED' && (
                      <button onClick={() => void publishResult(selectedAttempt)} disabled={busy} className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Publish result to student</button>
                    )}
                    {selectedAttempt.result?.status === 'PUBLISHED' && <p className="text-sm font-semibold text-emerald-700">Result published to the student.</p>}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>

      {preview && editor && (
        <div role="dialog" aria-modal="true" aria-label="Exam preview" className="fixed inset-0 z-30 overflow-y-auto bg-slate-950/70 p-4 md:p-10">
          <div className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-2xl md:p-9">
            <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-widest text-blue-700">Preview · not yet published</div><h2 className="mt-2 text-2xl font-bold">{editor.title || 'Untitled examination'}</h2><p className="mt-1 text-sm text-slate-500">{editor.subject || 'No subject'} · {editor.durationMinutes} minutes · {editor.maxMarks} marks</p></div><button onClick={() => setPreview(false)} className="rounded-lg border px-3 py-2 text-sm font-semibold">Close</button></div>
            <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm whitespace-pre-wrap">{editor.instructions || 'No instructions provided.'}</p>
            <div className="mt-6 space-y-5">{editor.questions.map((question, index) => <article key={question.key} className="border-b border-slate-100 pb-5"><div className="flex justify-between gap-3"><h3 className="font-semibold">{index + 1}. {question.prompt || 'Question prompt'}</h3><span className="text-xs text-slate-500">{question.marks} marks</span></div>{question.type === 'DESCRIPTIVE' ? <div className="mt-3 h-24 rounded-lg border border-slate-200" /> : <div className="mt-3 space-y-2">{question.options.map((option) => <div key={option.key} className="flex gap-2 text-sm"><span>{question.type === 'SINGLE_CHOICE' ? '○' : '□'}</span>{option.text || 'Option text'}</div>)}</div>}</article>)}</div>
          </div>
        </div>
      )}
    </main>
  );
}
