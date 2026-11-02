import React, { useEffect, useRef, useState } from 'react';

type Customer = { name: string; email: string };
type Ticket = { id: string; title: string; status: string; createdAt?: string; createdat?: string; description?: string };
type CustomerMessage = { id: string; sender: string; content: string; timestamp: string };
type Tab = 'register' | 'sign-in';

async function customerApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/customer' + path, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(result.error || 'Unable to complete your request'));
  return result as T;
}

export function CustomerSelfService() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<CustomerMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const messageRetryKey = useRef<string | null>(null);
  const [tab, setTab] = useState<Tab>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState<'loading' | 'ready' | 'working'>('loading');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const retryKey = useRef<string | null>(null);
  const path = window.location.pathname;
  const flowToken = new URLSearchParams(window.location.search).get('token');
  const isVerify = path === '/customer/verify';
  const isLogin = path === '/customer/login';

  async function refreshTickets() {
    const result = await customerApi<{ tickets: Ticket[] }>('/tickets');
    setTickets(result.tickets || []);
  }

  useEffect(() => {
    let canceled = false;
    customerApi<{ customer: Customer }>('/me')
      .then(async (result) => {
        if (canceled) return;
        setCustomer(result.customer);
        await refreshTickets();
      })
      .catch(() => { /* 401 is an expected signed-out state; no staff fallback. */ })
      .finally(() => { if (!canceled) setActive('ready'); });
    return () => { canceled = true; };
  }, []);

  async function perform(run: () => Promise<void>) {
    setActive('working'); setError(''); setNotice('');
    try { await run(); } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed; please try again');
    } finally { setActive('ready'); }
  }

  async function submitRegistration(event: React.FormEvent) {
    event.preventDefault();
    await perform(async () => {
      await customerApi('/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, consent })
      });
      setNotice('If eligible, a verification email will arrive shortly. Check your inbox.');
    });
  }

  async function sendLogin(event: React.FormEvent) {
    event.preventDefault();
    await perform(async () => {
      await customerApi('/request-login', { method: 'POST', body: JSON.stringify({ email }) });
      setNotice('If an account exists, a sign-in link will arrive shortly.');
    });
  }

  async function redeemLink() {
    if (!flowToken || (!isVerify && !isLogin)) return;
    await perform(async () => {
      const path = isVerify ? '/verify' : '/login';
      const result = await customerApi<{ customer: Customer }>(path, {
        method: 'POST', body: JSON.stringify({ token: flowToken })
      });
      setCustomer(result.customer);
      window.history.replaceState(null, '', '/customer');
      await refreshTickets();
      setNotice('Your customer account is ready.');
    });
  }

  async function submitTicket(event: React.FormEvent) {
    event.preventDefault();
    if (!retryKey.current) retryKey.current = crypto.randomUUID();
    await perform(async () => {
      const result = await customerApi<{ ticket: Ticket }>('/tickets', {
        method: 'POST',
        headers: { 'Idempotency-Key': retryKey.current! },
        body: JSON.stringify({ title, description })
      });
      retryKey.current = null;
      setTitle(''); setDescription('');
      await refreshTickets();
      setNotice('Service request ' + result.ticket.id.slice(0, 8) + ' received. Scheduling will be confirmed by our team.');
    });
  }

  async function viewTicket(id: string) {
    await perform(async () => {
      const [details, conversation] = await Promise.all([
        customerApi<{ticket: Ticket}>('/tickets/' + encodeURIComponent(id)),
        customerApi<{messages: CustomerMessage[]}>('/tickets/' + encodeURIComponent(id) + '/messages')
      ]);
      setSelectedTicket(details.ticket);
      setMessages(conversation.messages || []);
      setMessageDraft('');
      messageRetryKey.current = null;
    });
  }

  async function submitMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTicket) return;
    if (!messageRetryKey.current) messageRetryKey.current = crypto.randomUUID();
    await perform(async () => {
      const result = await customerApi<{message: CustomerMessage}>(
        '/tickets/' + encodeURIComponent(selectedTicket.id) + '/messages', {
          method: 'POST', headers: { 'Idempotency-Key': messageRetryKey.current! },
          body: JSON.stringify({ content: messageDraft })
        });
      setMessages((previous) => previous.some((m) => m.id === result.message.id)
        ? previous : [...previous, result.message]);
      setMessageDraft(''); messageRetryKey.current = null;
      setNotice('Message added to your service request.');
    });
  }

  async function logout() {
    await perform(async () => {
      await customerApi('/logout', { method: 'POST', body: '{}' });
      setCustomer(null); setTickets([]); setSelectedTicket(null); setMessages([]);
      setMessageDraft(''); messageRetryKey.current=null; setNotice('Signed out.');
    });
  }

  const working = active !== 'ready';
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
          <a href="/customer" className="text-xl font-semibold tracking-tight text-slate-900">TIQUET <span className="font-normal text-slate-500">Customer</span></a>
          {customer ? <button type="button" onClick={logout} disabled={working} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">Sign out</button> :
            <span className="text-sm text-slate-500">Secure customer service</span>}
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-5 py-10">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-teal-700">V79 Digital service portal</p>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight">{customer ? 'Your service requests' : 'A better way to request support'}</h1>
        <p className="mb-8 max-w-2xl text-slate-600">Submit a service request and follow its progress. A request is not a confirmed appointment or charge.</p>
        {error && <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="mb-5 rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-800">{notice}</p>}
        {active === 'loading' ? <p aria-live="polite">Checking your customer session…</p> : customer ? (
          <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-1 text-lg font-semibold">New service request</h2>
              <p className="mb-6 text-sm text-slate-500">Hello {customer.name}. Describe what you need and we will follow up.</p>
              <form onSubmit={submitTicket} className="space-y-5">
                <label className="block text-sm font-medium">What do you need help with?
                  <input required maxLength={140} minLength={3} value={title} onChange={(e) => { setTitle(e.target.value); retryKey.current=null; }} className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3" placeholder="For example, office Wi-Fi installation" />
                </label>
                <label className="block text-sm font-medium">Details
                  <textarea required minLength={3} maxLength={4000} rows={5} value={description} onChange={(e) => { setDescription(e.target.value);retryKey.current=null; }} className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3" placeholder="Location, equipment and preferred contact details" />
                </label>
                <button disabled={working} className="w-full rounded-lg bg-teal-700 px-4 py-3 font-semibold text-white hover:bg-teal-800 disabled:opacity-60">Submit request</button>
              </form>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-5 text-lg font-semibold">My requests</h2>
              {!tickets.length ? <p className="text-sm text-slate-500">No requests yet. Your new request will appear here once submitted.</p> :
                <ul className="space-y-3">{tickets.map((ticket) => (
                  <li key={ticket.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <strong className="text-sm">{ticket.title}</strong>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium">{ticket.status}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-500">Request {ticket.id.slice(0, 8)}</p>
                      <button type="button" onClick={() => viewTicket(ticket.id)} disabled={working}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                        View details
                      </button>
                    </div>
                  </li>
                ))}</ul>}
              {selectedTicket && <div className="mt-6 rounded-lg border border-teal-200 bg-teal-50/50 p-4" aria-label="Selected request details">
                <h3 className="mb-3 text-base font-semibold">{selectedTicket.title}</h3>
                <dl className="space-y-2 text-sm">
                  <div><dt className="inline font-semibold text-slate-700">Current status: </dt>
                    <dd className="inline">{selectedTicket.status}</dd></div>
                  <div><dt className="inline font-semibold text-slate-700">Request ID: </dt>
                    <dd className="inline break-all">{selectedTicket.id.slice(0, 8)}</dd></div>
                  <div><dt className="font-semibold text-slate-700">Description</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-slate-600">{selectedTicket.description || 'No description provided.'}</dd></div>
                </dl>
                <p className="mt-3 text-xs text-slate-500">Status is supplied by the service team. Scheduling and payment are not confirmed here.</p>
                <div className="mt-5 border-t border-teal-200 pt-4">
                  <h4 className="mb-3 text-sm font-semibold">Service conversation</h4>
                  {!messages.length && <p className="mb-3 text-sm text-slate-500">No messages yet. Use this form to ask the service team a question.</p>}
                  <ul className="mb-4 max-h-64 space-y-3 overflow-auto">
                    {messages.map((message) => (
                      <li key={message.id} className="rounded-md border border-slate-200 bg-white p-3">
                        <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs">
                          <strong className="font-semibold text-slate-700">{message.sender}</strong>
                          <span className="text-slate-500">{new Date(message.timestamp).toLocaleString()}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{message.content}</p>
                      </li>
                    ))}
                  </ul>
                  <form onSubmit={submitMessage} className="space-y-3">
                    <label className="block text-sm font-semibold">Write a message
                      <textarea rows={3} required maxLength={2000} minLength={3}
                        value={messageDraft}
                        onChange={(e) => {setMessageDraft(e.target.value);messageRetryKey.current=null;}}
                        className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal"
                        placeholder="Ask a question about this service request" />
                    </label>
                    <button type="submit" disabled={working}
                      className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                      Send message
                    </button>
                  </form>
                </div>
              </div>}
            </section>
          </div>
        ) : flowToken && (isVerify || isLogin) ? (
          <section className="max-w-lg rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
            <h2 className="mb-3 text-xl font-semibold">{isVerify ? 'Verify your email' : 'Sign in securely'}</h2>
            <p className="mb-5 text-sm text-slate-600">Confirm that you opened the email link to continue. Links can only be used once.</p>
            <button onClick={redeemLink} disabled={working} className="rounded-lg bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-60">Continue securely</button>
          </section>
        ) : (
          <section className="max-w-lg rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
            <div className="mb-6 flex gap-2" role="tablist" aria-label="Customer access">
              <button role="tab" aria-selected={tab==='register'} onClick={()=>setTab('register')} className={'rounded-lg px-4 py-2 text-sm font-medium ' + (tab==='register' ? 'bg-slate-900 text-white' : 'bg-slate-100')}>Create account</button>
              <button role="tab" aria-selected={tab==='sign-in'} onClick={()=>setTab('sign-in')} className={'rounded-lg px-4 py-2 text-sm font-medium ' + (tab==='sign-in' ? 'bg-slate-900 text-white' : 'bg-slate-100')}>Sign in</button>
            </div>
            <form onSubmit={tab === 'register' ? submitRegistration : sendLogin} className="space-y-5">
              {tab === 'register' && <label className="block text-sm font-medium">Full name
                <input required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={(e)=>setName(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3" />
              </label>}
              <label className="block text-sm font-medium">Email address
                <input required type="email" autoComplete="email" maxLength={254} value={email} onChange={(e)=>setEmail(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3" />
              </label>
              {tab==='register' && <label className="flex items-start gap-3 text-sm text-slate-600">
                <input type="checkbox" required checked={consent} onChange={(e)=>setConsent(e.target.checked)} className="mt-1" />
                <span>I agree to receive service-related emails needed to verify my account and manage tickets. I am not opting into marketing emails.</span>
              </label>}
              <button disabled={working} className="w-full rounded-lg bg-teal-700 px-4 py-3 font-semibold text-white hover:bg-teal-800 disabled:opacity-60">{tab === 'register' ? 'Create customer account' : 'Send secure sign-in link'}</button>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}
