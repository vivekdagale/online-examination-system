'use client';
import { useEffect, useMemo, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
type User = { id: string; name: string; email: string; role: 'ADMIN'|'FACULTY'|'STUDENT' };
type Exam = { id: string; title: string; subject: string; instructions: string; durationMinutes: number; maxMarks: number; opensAt: string; closesAt: string; state: string; attempt?: { id: string; status: string } | null };
type Attempt = { id: string; status: string; deadlineAt: string; serverNow: string; answers: { questionId: string; selectedIds: string[]; textAnswer?: string; isFlagged: boolean }[]; exam: { title: string; durationMinutes: number; questions: { id: string; prompt: string; type: string; marks: number; options: { id: string; text: string }[] }[] } };

export default function Home() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<User|null>(null);
  const [email, setEmail] = useState('student@oes.local');
  const [password, setPassword] = useState('ChangeThis123!');
  const [message, setMessage] = useState('');
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempt, setAttempt] = useState<Attempt|null>(null);
  const [seconds, setSeconds] = useState(0);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string,{selectedIds:string[];textAnswer:string;isFlagged:boolean}>>({});
  const [busy, setBusy] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [regName, setRegName] = useState('');
  const [regRole, setRegRole] = useState<'STUDENT'|'FACULTY'>('STUDENT');
  const headers = useMemo(() => ({ 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }), [token]);

  async function api(path:string, init:RequestInit={}) {
    const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers||{}) } });
    const data = await response.json().catch(()=>({message:'Unexpected server response'}));
    if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message || `Request failed (${response.status})`);
    return data;
  }
  async function login(e:React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const data = await api(registerMode?'/auth/register':'/auth/login', { method:'POST', body:JSON.stringify(registerMode?{name:regName,email,password,role:regRole}:{email,password}) });
      if(registerMode) { setMessage(data.message); setRegisterMode(false); }
      else if (data.user.role === 'ADMIN') {
        window.localStorage.setItem('oes_admin_session', JSON.stringify({ accessToken: data.accessToken, user: data.user }));
        window.location.assign('/admin');
      }
      else if (data.user.role === 'FACULTY') {
        window.localStorage.setItem('oes_faculty_session', JSON.stringify({ accessToken: data.accessToken, user: data.user }));
        window.location.assign('/faculty');
      }
      else {
        window.localStorage.setItem('oes_student_session', JSON.stringify({ accessToken: data.accessToken, user: data.user }));
        window.location.assign('/student');
      }
    } catch(e:any) { setMessage(e.message); } finally { setBusy(false); }
  }
  async function loadExams() {
    try { const data = await api('/exams'); setExams(data); } catch(e:any) { setMessage(e.message); }
  }
  useEffect(()=>{ if(token && user?.role==='STUDENT') loadExams(); },[token,user]);
  useEffect(()=>{ if(!attempt) return; const tick=()=>setSeconds(Math.max(0,Math.floor((new Date(attempt.deadlineAt).getTime()-Date.now())/1000))); tick(); const id=setInterval(tick,1000); return ()=>clearInterval(id); },[attempt]);
  useEffect(()=>{ if(seconds===0 && attempt?.status==='IN_PROGRESS') setMessage('The deadline has elapsed. Reconnect to refresh server attempt state.'); },[seconds,attempt]);
  async function startExam(exam:Exam) {
    if(!window.confirm(`Start "${exam.title}"? Your server-controlled timer starts now.`)) return;
    try { const data=await api(`/exams/${exam.id}/start`,{method:'POST',body:JSON.stringify({acknowledge:true})}); await openAttempt(data.id); }
    catch(e:any){setMessage(e.message);}
  }
  async function openAttempt(id:string) {
    try {
      const data:Attempt=await api(`/attempts/${id}`);
      setAttempt(data); setCurrent(0);
      const restored:Record<string,{selectedIds:string[];textAnswer:string;isFlagged:boolean}>={};
      data.answers.forEach(a=>restored[a.questionId]={selectedIds:a.selectedIds||[],textAnswer:a.textAnswer||'',isFlagged:a.isFlagged});
      setAnswers(restored); setMessage('Attempt loaded. Answers are restored from the server.');
    } catch(e:any){setMessage(e.message);}
  }
  async function persist(questionId:string, next:{selectedIds:string[];textAnswer:string;isFlagged:boolean}) {
    if(!attempt) return;
    setAnswers(prev=>({...prev,[questionId]:next}));
    try {
      await api(`/attempts/${attempt.id}/questions/${questionId}/answer`,{method:'POST',body:JSON.stringify({selectedIds:next.selectedIds,textAnswer:next.textAnswer||undefined})});
      setMessage('Answer saved to server.');
    } catch(e:any){setMessage(`Save failed: ${e.message}. Keep this page open and retry.`);}
  }
  async function flag(questionId:string) {
    if(!attempt) return; const next={...(answers[questionId]||{selectedIds:[],textAnswer:'',isFlagged:false}),isFlagged:!answers[questionId]?.isFlagged};
    setAnswers(prev=>({...prev,[questionId]:next}));
    try { await api(`/attempts/${attempt.id}/questions/${questionId}/flag`,{method:'POST',body:JSON.stringify({flagged:next.isFlagged})}); }
    catch(e:any){setMessage(e.message);}
  }
  async function submit() {
    if(!attempt) return;
    try { const data=await api(`/attempts/${attempt.id}/submit`,{method:'POST',body:'{}'}); setMessage(`Submission recorded: ${data.status}. ${data.submissionReason||''}`); setAttempt(null); setConfirmSubmit(false); await loadExams(); }
    catch(e:any){setMessage(e.message);}
  }
  async function logout(){setToken('');setUser(null);setAttempt(null);setExams([]);setMessage('Signed out.');}
  const activeQuestion=attempt?.exam.questions[current];
  const answeredCount=attempt?attempt.exam.questions.filter(q=>{const a=answers[q.id];return !!a&&(a.selectedIds.length>0||a.textAnswer.trim().length>0)}).length:0;
  const flaggedCount=attempt?attempt.exam.questions.filter(q=>answers[q.id]?.isFlagged).length:0;
  const timeLabel=`${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;

  return <main className="min-h-screen">
    <header className="bg-slate-950 text-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5"><div><div className="text-xs uppercase tracking-[.25em] text-cyan-300">College Examination Portal</div><h1 className="mt-1 text-2xl font-bold">OES <span className="font-normal text-slate-300">/ Online Examination System</span></h1></div>{user&&<button className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800" onClick={logout}>Sign out</button>}</div></header>
    <div className="mx-auto max-w-6xl px-5 py-8">
      {message&&<div role="status" className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{message}</div>}
      {!user ? <section className="mx-auto grid max-w-4xl overflow-hidden rounded-3xl bg-white shadow-xl md:grid-cols-2">
        <div className="bg-gradient-to-br from-slate-900 to-blue-900 p-8 text-white md:p-10"><div className="mb-8 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs">Secure assessment workspace</div><h2 className="text-3xl font-bold leading-tight">Your exams.<br/>Your progress.<br/>One portal.</h2><p className="mt-5 text-sm leading-6 text-blue-100">Server-controlled timers, persistent answers, question navigation, and secure result access.</p><div className="mt-10 grid grid-cols-2 gap-3"><div className="rounded-xl bg-white/10 p-4"><div className="text-2xl font-bold">01</div><div className="mt-1 text-xs text-blue-100">Authenticated access</div></div><div className="rounded-xl bg-white/10 p-4"><div className="text-2xl font-bold">02</div><div className="mt-1 text-xs text-blue-100">Auto-save workflow</div></div></div></div>
        <form onSubmit={login} className="p-8 md:p-10"><h2 className="text-2xl font-bold text-slate-900">{registerMode?'Create account':'Welcome back'}</h2><p className="mt-2 text-sm text-slate-500">{registerMode?'Registration requires administrator activation.':'Sign in to access your role-based workspace.'}</p>
          {registerMode&&<><label className="mt-5 block text-sm font-medium">Full name<input required value={regName} onChange={e=>setRegName(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"/></label><label className="mt-4 block text-sm font-medium">Account type<select value={regRole} onChange={e=>setRegRole(e.target.value as any)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"><option value="STUDENT">Student</option><option value="FACULTY">Faculty</option></select></label></>}
          <label className="mt-5 block text-sm font-medium">Email address<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"/></label><label className="mt-4 block text-sm font-medium">Password<input type="password" required value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"/></label>
          <button disabled={busy} className="mt-6 w-full rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{busy?'Please wait…':registerMode?'Register account':'Sign in'}</button><button type="button" onClick={()=>setRegisterMode(!registerMode)} className="mt-4 w-full text-sm font-medium text-blue-700">{registerMode?'Back to sign in':'New here? Register a student or faculty account'}</button><p className="mt-5 text-xs leading-5 text-slate-400">Development demo credentials are in docs/setup-guide.md. Change seeded passwords before sharing this project.</p>
        </form>
      </section> : attempt ? <section className="rounded-3xl bg-white p-5 shadow-xl md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5"><div><div className="text-sm font-semibold text-blue-700">ACTIVE EXAMINATION</div><h2 className="mt-1 text-2xl font-bold">{attempt.exam.title}</h2><p className="mt-1 text-sm text-slate-500">Signed in as {user.name}</p></div><div className={`rounded-2xl px-5 py-3 text-center ${seconds<300?'bg-red-50 text-red-700':'bg-slate-900 text-white'}`}><div className="text-xs uppercase tracking-wider">Time remaining</div><div className="font-mono text-2xl font-bold">{timeLabel}</div></div></div>
        <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_240px]"><div><div className="flex items-center justify-between text-sm text-slate-500"><span>Question {current+1} of {attempt.exam.questions.length}</span><span>{activeQuestion?.marks} marks</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{width:`${(current+1)/attempt.exam.questions.length*100}%`}}/></div>
          {activeQuestion&&<div className="mt-6 rounded-2xl border border-slate-200 p-5 md:p-7"><div className="text-xs font-bold uppercase tracking-widest text-slate-400">{activeQuestion.type.replace('_',' ')}</div><h3 className="mt-3 text-xl font-semibold leading-8">{activeQuestion.prompt}</h3>
          {activeQuestion.type==='DESCRIPTIVE'?<textarea value={answers[activeQuestion.id]?.textAnswer||''} onChange={e=>persist(activeQuestion.id,{...(answers[activeQuestion.id]||{selectedIds:[],isFlagged:false}),textAnswer:e.target.value})} rows={7} placeholder="Write your answer here…" className="mt-6 w-full rounded-xl border border-slate-200 p-4 outline-none focus:border-blue-500"/>:<div className="mt-5 space-y-3">{activeQuestion.options.map(option=>{const selected=answers[activeQuestion.id]?.selectedIds.includes(option.id)||false;const multi=activeQuestion.type==='MULTIPLE_SELECT';return <label key={option.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${selected?'border-blue-500 bg-blue-50':'border-slate-200 hover:border-slate-300'}`}><input type={multi?'checkbox':'radio'} name={activeQuestion.id} checked={selected} onChange={()=>{const old=answers[activeQuestion.id]||{selectedIds:[],textAnswer:'',isFlagged:false};const ids=multi?(selected?old.selectedIds.filter(x=>x!==option.id):[...old.selectedIds,option.id]):[option.id];persist(activeQuestion.id,{...old,selectedIds:ids});}}/><span>{option.text}</span></label>})}</div>}
          <div className="mt-5 flex flex-wrap gap-2"><button onClick={()=>flag(activeQuestion.id)} className={`rounded-lg px-3 py-2 text-sm font-medium ${answers[activeQuestion.id]?.isFlagged?'bg-amber-100 text-amber-800':'bg-slate-100 text-slate-700'}`}>{answers[activeQuestion.id]?.isFlagged?'★ Flagged for review':'☆ Flag for review'}</button><button onClick={()=>persist(activeQuestion.id,{...(answers[activeQuestion.id]||{selectedIds:[],isFlagged:false}),textAnswer:answers[activeQuestion.id]?.textAnswer||''})} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium">Save answer</button></div></div>}
          <div className="mt-5 flex justify-between"><button disabled={current===0} onClick={()=>setCurrent(x=>x-1)} className="rounded-xl border px-5 py-3 disabled:opacity-30">← Previous</button><button disabled={current>=attempt.exam.questions.length-1} onClick={()=>setCurrent(x=>x+1)} className="rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-30">Next →</button></div>
        </div><aside><div className="rounded-2xl bg-slate-50 p-4"><h3 className="font-semibold">Question palette</h3><div className="mt-3 grid grid-cols-5 gap-2">{attempt.exam.questions.map((q,i)=><button key={q.id} onClick={()=>setCurrent(i)} className={`relative h-10 rounded-lg border text-sm font-semibold ${i===current?'border-blue-700 bg-blue-700 text-white':answers[q.id]?.isFlagged?'border-amber-400 bg-amber-100':answers[q.id]&&(answers[q.id].selectedIds.length||answers[q.id].textAnswer.trim())?'border-green-300 bg-green-100 text-green-800':'border-slate-200 bg-white'}`}>{i+1}</button>)}</div><div className="mt-5 space-y-2 text-sm text-slate-600"><div className="flex justify-between"><span>Answered</span><b>{answeredCount}</b></div><div className="flex justify-between"><span>Unanswered</span><b>{attempt.exam.questions.length-answeredCount}</b></div><div className="flex justify-between"><span>Flagged</span><b>{flaggedCount}</b></div></div><button onClick={()=>setConfirmSubmit(true)} className="mt-5 w-full rounded-xl bg-rose-600 px-4 py-3 font-semibold text-white hover:bg-rose-700">Submit examination</button></div><p className="mt-3 text-xs leading-5 text-slate-400">Visibility-change monitoring is best-effort and is not definitive proof of misconduct.</p></aside></div>
        {confirmSubmit&&<div role="dialog" aria-modal="true" className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/60 p-5"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h3 className="text-xl font-bold">Submit examination?</h3><p className="mt-2 text-sm text-slate-600">Answered: {answeredCount} · Unanswered: {attempt.exam.questions.length-answeredCount} · Flagged: {flaggedCount}. Final submission cannot be edited.</p><div className="mt-6 flex justify-end gap-3"><button onClick={()=>setConfirmSubmit(false)} className="rounded-xl border px-4 py-2">Return to exam</button><button onClick={submit} className="rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white">Confirm submit</button></div></div></div>}
      </section> : <section><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-widest text-blue-700">{user.role} workspace</p><h2 className="mt-2 text-3xl font-bold">Hello, {user.name.split(' ')[0]}.</h2><p className="mt-2 text-slate-500">Here is your examination workspace.</p></div>{user.role==='STUDENT'&&<button onClick={loadExams} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold">Refresh exams ↻</button>}</div>
        {user.role==='STUDENT'?<div className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{exams.map(exam=><article key={exam.id} className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm"><div className="flex items-start justify-between gap-3"><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{exam.subject}</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${exam.state==='AVAILABLE'?'bg-green-50 text-green-700':'bg-slate-100 text-slate-600'}`}>{exam.state.replace('_',' ')}</span></div><h3 className="mt-4 text-lg font-bold">{exam.title}</h3><p className="mt-2 line-clamp-2 text-sm text-slate-500">{exam.instructions}</p><div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3"><div><div className="text-xs text-slate-400">Duration</div><div className="mt-1 font-semibold">{exam.durationMinutes} min</div></div><div><div className="text-xs text-slate-400">Maximum marks</div><div className="mt-1 font-semibold">{exam.maxMarks}</div></div></div>{exam.state==='IN_PROGRESS'&&exam.attempt?<button onClick={()=>openAttempt(exam.attempt!.id)} className="mt-4 w-full rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white">Resume attempt</button>:exam.state==='AVAILABLE'?<button onClick={()=>startExam(exam)} className="mt-4 w-full rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white">Read instructions & start</button>:<div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-500">No action available</div>}</article>)}{!exams.length&&<div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><h3 className="font-semibold">No eligible examinations</h3><p className="mt-2 text-sm text-slate-500">Published exams will appear here when available.</p></div>}</div>:<div className="mt-7 rounded-2xl bg-white p-8 shadow-sm"><h3 className="text-xl font-bold">{user.role==='ADMIN'?'Administration overview':'Faculty workspace'}</h3><p className="mt-2 text-slate-600">Your authentication is active. Examination authoring, account approvals, descriptive evaluation, and user-management screens need the corresponding role-specific API workflows to be enabled before deployment.</p></div>}
      </section>}
      <footer className="mt-10 border-t border-slate-200 py-5 text-xs text-slate-400">OES · College academic project · Keep your login credentials private.</footer>
    </div>
  </main>;
}
