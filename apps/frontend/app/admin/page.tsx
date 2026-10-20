'use client';

import { FormEvent, useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

type AdminSession = {
  accessToken: string;
  user: { id: string; name: string; email: string; role: 'ADMIN' };
};

type AccountStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';
type UserRole = 'ADMIN' | 'FACULTY' | 'STUDENT';
type User = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: string;
  facultyProfile: {
    department: string | null;
    employeeCode: string | null;
    verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
    verificationNote: string | null;
  } | null;
  studentProfile: {
    department: string | null;
    studentCode: string | null;
    year: number | null;
  } | null;
};

type DashboardStats = {
  totalUsers: number;
  students: number;
  faculty: number;
  pendingRegistrations: number;
  activeAccounts: number;
  disabledAccounts: number;
  rejectedRegistrations: number;
  pendingFacultyVerification: number;
  totalExams: number;
  publishedExams: number;
};

async function request<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
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

function statusStyle(status: AccountStatus) {
  switch (status) {
    case 'ACTIVE':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    case 'PENDING':
      return 'bg-amber-50 text-amber-700 ring-amber-200';
    case 'DISABLED':
      return 'bg-slate-100 text-slate-600 ring-slate-200';
    case 'REJECTED':
      return 'bg-rose-50 text-rose-700 ring-rose-200';
  }
}

function verificationStyle(status: string) {
  return status === 'APPROVED'
    ? 'text-emerald-700'
    : status === 'REJECTED'
      ? 'text-rose-700'
      : 'text-amber-700';
}

export default function AdminPage() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [busyUser, setBusyUser] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = window.localStorage.getItem('oes_admin_session');
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
          value.user.role === 'ADMIN'
        ) {
          setSession(value as AdminSession);
        } else {
          window.localStorage.removeItem('oes_admin_session');
        }
      } catch {
        window.localStorage.removeItem('oes_admin_session');
      }
    }
    setSessionReady(true);
  }, []);

  async function loadDashboard(
    activeSession: AdminSession,
    filters: { search?: string; role?: string; status?: string } = {},
  ) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.role) params.set('role', filters.role);
    if (filters.status) params.set('status', filters.status);
    try {
      const [nextStats, nextUsers] = await Promise.all([
        request<DashboardStats>('/auth/admin/stats', activeSession.accessToken),
        request<User[]>(
          `/auth/admin/users${params.size ? `?${params.toString()}` : ''}`,
          activeSession.accessToken,
        ),
      ]);
      setStats(nextStats);
      setUsers(nextUsers);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Unable to load admin data.';
      setError(message);
      if (
        message.includes('Insufficient role permissions') ||
        message.includes('Invalid or expired') ||
        message.includes('required')
      ) {
        window.localStorage.removeItem('oes_admin_session');
        setSession(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session) void loadDashboard(session);
  }, [session]);

  function searchUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
    if (session) {
      void loadDashboard(session, {
        search: searchInput.trim(),
        role,
        status,
      });
    }
  }

  function changeFilter(nextRole: string, nextStatus: string) {
    setRole(nextRole);
    setStatus(nextStatus);
    if (session) {
      void loadDashboard(session, { search, role: nextRole, status: nextStatus });
    }
  }

  async function updateUser(user: User, action: 'approve' | 'reject' | 'activate' | 'deactivate') {
    if (!session) return;
    const prompts: Record<typeof action, string> = {
      approve: `Approve ${user.name}'s registration?`,
      reject: `Reject ${user.name}'s registration?`,
      activate: `Activate ${user.name}'s account?`,
      deactivate: `Deactivate ${user.name}'s account?`,
    };
    if (action !== 'approve' && !window.confirm(prompts[action])) return;

    setBusyUser(user.id);
    setError('');
    try {
      const result = await request<{ message: string }>(
        `/auth/admin/users/${encodeURIComponent(user.id)}/${action}`,
        session.accessToken,
        { method: 'PATCH' },
      );
      await loadDashboard(session, { search, role, status });
      setError(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update account.');
    } finally {
      setBusyUser('');
    }
  }

  function logout() {
    window.localStorage.removeItem('oes_admin_session');
    window.location.assign('/');
  }

  if (!sessionReady) {
    return <main className="grid min-h-screen place-items-center text-slate-500">Loading administrator workspace...</main>;
  }

  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-5 text-center text-white">
        <section className="max-w-md rounded-3xl border border-white/10 bg-white/5 p-9 shadow-2xl">
          <div className="text-xs font-semibold uppercase tracking-[.25em] text-cyan-300">OES Administration</div>
          <h1 className="mt-4 text-3xl font-bold">Administrator sign-in required</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Sign in with an administrator account to access user records and account controls.
          </p>
          <a href="/" className="mt-7 inline-flex rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300">
            Go to sign in
          </a>
        </section>
      </main>
    );
  }

  const cards: { label: string; value: number; note: string; tone: string }[] = stats
    ? [
        { label: 'Total users', value: stats.totalUsers, note: `${stats.students} students · ${stats.faculty} faculty`, tone: 'text-slate-900' },
        { label: 'Pending registrations', value: stats.pendingRegistrations, note: `${stats.pendingFacultyVerification} faculty verifications`, tone: 'text-amber-700' },
        { label: 'Active accounts', value: stats.activeAccounts, note: 'Currently able to sign in', tone: 'text-emerald-700' },
        { label: 'Disabled accounts', value: stats.disabledAccounts, note: `${stats.rejectedRegistrations} rejected registrations`, tone: 'text-slate-700' },
        { label: 'Examinations', value: stats.totalExams, note: `${stats.publishedExams} published`, tone: 'text-blue-700' },
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
              <h1 className="mt-1 text-xl font-bold">Administrator workspace</h1>
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
            <div className="text-sm font-semibold text-blue-700">OVERVIEW</div>
            <h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Dashboard</h2>
            <p className="mt-2 text-sm text-slate-500">Monitor registrations, user access, and examination activity.</p>
          </div>
          <button
            onClick={() => void loadDashboard(session, { search, role, status })}
            disabled={loading}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh data'}
          </button>
        </div>

        {error && (
          <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss message" className="font-bold">×</button>
          </div>
        )}

        <section aria-label="Database statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => (
            <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-medium text-slate-500">{card.label}</div>
              <div className={`mt-3 text-3xl font-bold tracking-tight ${card.tone}`}>{stats ? card.value : '—'}</div>
              <div className="mt-2 text-xs text-slate-500">{card.note}</div>
            </article>
          ))}
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-5 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-950">User management</h3>
                <p className="mt-1 text-sm text-slate-500">Review registrations and manage account access.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{users.length} users shown</span>
            </div>
            <form onSubmit={searchUsers} className="mt-5 grid gap-3 md:grid-cols-[minmax(220px,1fr)_180px_180px_auto]">
              <label className="sr-only" htmlFor="user-search">Search users</label>
              <input
                id="user-search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by name or email"
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <label className="sr-only" htmlFor="role-filter">Filter by role</label>
              <select id="role-filter" value={role} onChange={(event) => changeFilter(event.target.value, status)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                <option value="">All roles</option>
                <option value="ADMIN">Administrator</option>
                <option value="STUDENT">Student</option>
                <option value="FACULTY">Faculty</option>
              </select>
              <label className="sr-only" htmlFor="status-filter">Filter by status</label>
              <select id="status-filter" value={status} onChange={(event) => changeFilter(role, event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                <option value="">All statuses</option>
                <option value="PENDING">Pending</option>
                <option value="ACTIVE">Active</option>
                <option value="DISABLED">Disabled</option>
                <option value="REJECTED">Rejected</option>
              </select>
              <button disabled={loading} className="rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">Search</button>
            </form>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-semibold">User</th>
                  <th className="px-6 py-4 font-semibold">Role / profile</th>
                  <th className="px-6 py-4 font-semibold">Account status</th>
                  <th className="px-6 py-4 font-semibold">Faculty verification</th>
                  <th className="px-6 py-4 font-semibold">Registered</th>
                  <th className="px-6 py-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/70">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">{user.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{user.email}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-700">{user.role}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {user.facultyProfile?.department || user.studentProfile?.department || '—'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusStyle(user.status)}`}>{user.status}</span>
                    </td>
                    <td className="px-6 py-4">
                      {user.role === 'FACULTY' && user.facultyProfile ? (
                        <span className={`text-xs font-semibold ${verificationStyle(user.facultyProfile.verificationStatus)}`}>
                          {user.facultyProfile.verificationStatus}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        {user.status === 'PENDING' && user.role !== 'ADMIN' && (
                          <>
                            <button disabled={busyUser === user.id} onClick={() => void updateUser(user, 'approve')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                              {busyUser === user.id ? 'Working...' : 'Approve'}
                            </button>
                            <button disabled={busyUser === user.id} onClick={() => void updateUser(user, 'reject')} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Reject</button>
                          </>
                        )}
                        {user.status === 'ACTIVE' && user.role !== 'ADMIN' && (
                          <button disabled={busyUser === user.id} onClick={() => void updateUser(user, 'deactivate')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Deactivate</button>
                        )}
                        {user.status === 'DISABLED' && user.role !== 'ADMIN' && (
                          <button disabled={busyUser === user.id} onClick={() => void updateUser(user, 'activate')} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50">Activate</button>
                        )}
                        {(user.status === 'REJECTED' || user.role === 'ADMIN') && <span className="py-2 text-xs text-slate-400">No actions</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                {!users.length && (
                  <tr><td colSpan={6} className="px-6 py-14 text-center text-sm text-slate-500">{loading ? 'Loading users...' : 'No users match these filters.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-6 py-4 text-xs text-slate-500">
            Account changes are recorded in the audit log. Administrator accounts cannot be disabled through this screen.
          </div>
        </section>
      </div>
    </main>
  );
}
