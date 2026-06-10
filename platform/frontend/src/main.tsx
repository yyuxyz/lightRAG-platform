import React, { FormEvent, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  Database,
  FileText,
  LogOut,
  Network,
  Search,
  Shield,
  Upload,
  Users
} from 'lucide-react'
import './styles.css'

type User = {
  id: number
  username: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
  workspace_id: string
  created_at: string
  updated_at: string
  last_login_at?: string | null
}

type ApiValidationItem = {
  loc?: Array<string | number>
  msg?: string
}
type ApiError = { detail?: string | ApiValidationItem[] | Record<string, unknown> }

const tokenKey = 'LIGHTRAG_PLATFORM_TOKEN'

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(tokenKey)
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(path, { ...init, headers })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const data = (await response.json()) as ApiError
      message = formatApiError(data.detail) || message
    } catch {}
    throw new Error(message)
  }
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return response.json()
  return response.text() as T
}

function formatApiError(detail: ApiError['detail']): string {
  if (!detail) return ''
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = item.loc?.filter((part) => part !== 'body').join('.') || ''
        return field ? `${field}: ${item.msg || '输入不合法'}` : item.msg || '输入不合法'
      })
      .join('；')
  }
  try {
    return JSON.stringify(detail)
  } catch {
    return '请求失败'
  }
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('ChangeMe123!')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await api<{ access_token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
      localStorage.setItem(tokenKey, data.access_token)
      onLogin(data.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-mark">
          <Database size={28} />
        </div>
        <h1>LightRAG Platform</h1>
        <p>多用户隔离的 RAG 工作台</p>
        <form onSubmit={submit} className="login-form">
          <label>
            用户名
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <div className="error-box">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </section>
    </main>
  )
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [view, setView] = useState('dashboard')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<User>('/api/auth/me')
      .then(setUser)
      .catch(() => localStorage.removeItem(tokenKey))
      .finally(() => setLoading(false))
  }, [])

  function logout() {
    localStorage.removeItem(tokenKey)
    setUser(null)
  }

  if (loading) return <div className="boot">正在连接平台...</div>
  if (!user) return <Login onLogin={setUser} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="side-title">
          <Database size={22} />
          <span>LightRAG</span>
        </div>
        <NavButton id="dashboard" view={view} setView={setView} icon={<Activity />} label="概览" />
        <NavButton id="documents" view={view} setView={setView} icon={<FileText />} label="文档" />
        <NavButton id="query" view={view} setView={setView} icon={<Search />} label="查询" />
        <NavButton id="graph" view={view} setView={setView} icon={<Network />} label="图谱" />
        {user.role === 'admin' && (
          <NavButton id="users" view={view} setView={setView} icon={<Users />} label="用户" />
        )}
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <strong>{user.username}</strong>
            <span>{user.role === 'admin' ? '管理员' : '普通用户'} · {user.workspace_id}</span>
          </div>
          <button className="ghost" onClick={logout}>
            <LogOut size={17} />
            退出
          </button>
        </header>
        {view === 'dashboard' && <Dashboard user={user} />}
        {view === 'documents' && <Documents />}
        {view === 'query' && <Query />}
        {view === 'graph' && <Graph />}
        {view === 'users' && user.role === 'admin' && <UsersAdmin />}
      </main>
    </div>
  )
}

function NavButton(props: {
  id: string
  view: string
  setView: (view: string) => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button className={props.view === props.id ? 'nav active' : 'nav'} onClick={() => props.setView(props.id)}>
      {props.icon}
      {props.label}
    </button>
  )
}

function Dashboard({ user }: { user: User }) {
  const [platform, setPlatform] = useState<Record<string, string> | null>(null)
  const [rag, setRag] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api<Record<string, string>>('/api/platform/health'), api<Record<string, unknown>>('/api/rag/health')])
      .then(([platformStatus, ragStatus]) => {
        setPlatform(platformStatus)
        setRag(ragStatus)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '状态检查失败'))
  }, [])

  return (
    <section>
      <h2>概览</h2>
      <div className="stat-grid">
        <Stat title="当前用户" value={user.username} hint={user.workspace_id} />
        <Stat title="Platform" value={platform?.status || '检查中'} hint={platform?.runtime_mode || ''} />
        <Stat title="LightRAG" value={(rag?.status as string) || '检查中'} hint={`WebUI: ${String(rag?.webui_available ?? '-')}`} />
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="panel">
        <h3>架构状态</h3>
        <p>你正在使用外置平台入口。每个用户会按需启动独立 LightRAG runtime，并通过 workspace 隔离 RAG 数据。</p>
      </div>
    </section>
  )
}

function Stat({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="stat">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  )
}

function Documents() {
  const [file, setFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [documents, setDocuments] = useState<unknown>(null)

  async function upload() {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    setMessage('上传中...')
    try {
      const result = await api<unknown>('/api/lightrag/documents/upload', { method: 'POST', body: form })
      setMessage(JSON.stringify(result, null, 2))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '上传失败')
    }
  }

  async function loadDocuments() {
    try {
      const result = await api<unknown>('/api/lightrag/documents/paginated', {
        method: 'POST',
        body: JSON.stringify({ page: 1, page_size: 20 })
      })
      setDocuments(result)
    } catch (err) {
      setDocuments({ error: err instanceof Error ? err.message : '加载失败' })
    }
  }

  return (
    <section>
      <h2>文档管理</h2>
      <div className="panel row">
        <Upload size={20} />
        <input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        <button onClick={upload} disabled={!file}>上传到我的库</button>
        <button className="secondary" onClick={loadDocuments}>刷新文档</button>
      </div>
      {message && <pre className="console">{message}</pre>}
      {documents !== null && <pre className="console">{JSON.stringify(documents, null, 2)}</pre>}
    </section>
  )
}

function Query() {
  const [question, setQuestion] = useState('请总结我的知识库内容')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)

  async function ask() {
    setLoading(true)
    setAnswer('')
    try {
      const result = await api<unknown>('/api/lightrag/query', {
        method: 'POST',
        body: JSON.stringify({ query: question, mode: 'mix' })
      })
      setAnswer(JSON.stringify(result, null, 2))
    } catch (err) {
      setAnswer(err instanceof Error ? err.message : '查询失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section>
      <h2>知识库查询</h2>
      <div className="panel">
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
        <button onClick={ask} disabled={loading}>{loading ? '查询中...' : '查询我的库'}</button>
      </div>
      {answer && <pre className="console">{answer}</pre>}
    </section>
  )
}

function Graph() {
  const [label, setLabel] = useState('')
  const [data, setData] = useState<unknown>(null)

  async function load() {
    try {
      if (label.trim()) {
        setData(await api<unknown>(`/api/lightrag/graphs?label=${encodeURIComponent(label.trim())}&max_depth=3&max_nodes=1000`))
      } else {
        setData(await api<unknown>('/api/lightrag/graph/label/list'))
      }
    } catch (err) {
      setData({ error: err instanceof Error ? err.message : '图谱加载失败' })
    }
  }

  return (
    <section>
      <h2>图谱</h2>
      <div className="panel row">
        <Network size={20} />
        <input placeholder="起始标签（可选）" value={label} onChange={(event) => setLabel(event.target.value)} />
        <button onClick={load}>{label.trim() ? '加载我的图谱数据' : '加载标签列表'}</button>
      </div>
      {data !== null && <pre className="console">{JSON.stringify(data, null, 2)}</pre>}
    </section>
  )
}

function UsersAdmin() {
  const [users, setUsers] = useState<User[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const activeUsers = useMemo(() => users.filter((item) => item.status === 'active').length, [users])

  async function load() {
    try {
      setUsers(await api<User[]>('/api/admin/users'))
    } catch (err) {
      setError(err instanceof Error ? err.message : '用户加载失败')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function createUser(event: FormEvent) {
    event.preventDefault()
    const nextUsername = username.trim()
    if (!nextUsername || password.length < 6) {
      setError('请输入用户名，并确保初始密码至少 6 位')
      return
    }
    try {
      await api<User>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username: nextUsername, password, role: 'user' })
      })
      setUsername('')
      setPassword('')
      setError('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
  }

  async function toggleUser(target: User) {
    await api<User>(`/api/admin/users/${target.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: target.status === 'active' ? 'disabled' : 'active' })
    })
    await load()
  }

  return (
    <section>
      <h2>用户管理</h2>
      <div className="stat-grid">
        <Stat title="用户总数" value={String(users.length)} hint="Platform DB" />
        <Stat title="启用用户" value={String(activeUsers)} hint="active" />
        <Stat title="隔离策略" value="user_id" hint="user_{id}" />
      </div>
      <form className="panel user-form" onSubmit={createUser}>
        <Shield size={20} />
        <input placeholder="用户名" value={username} onChange={(event) => setUsername(event.target.value)} />
        <input placeholder="初始密码（至少 6 位）" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <button>创建用户</button>
      </form>
      {error && <div className="error-box">{error}</div>}
      <div className="table">
        {users.map((item) => (
          <div className="table-row" key={item.id}>
            <strong>{item.username}</strong>
            <span>{item.role}</span>
            <span>{item.status}</span>
            <span>{item.workspace_id}</span>
            <button className="secondary" onClick={() => toggleUser(item)}>
              {item.status === 'active' ? '禁用' : '启用'}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
