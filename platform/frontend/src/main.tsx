import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  Braces,
  Database,
  FileText,
  ListRestart,
  Loader2,
  LogOut,
  Maximize2,
  Network,
  RefreshCcw,
  Search,
  Shield,
  Trash2,
  Upload,
  Users,
  ZoomIn,
  ZoomOut
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
type ChangeEvent<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = { target: T }
type UINode = unknown

type DocumentRecord = {
  id?: string
  file_path?: string
  summary?: string
  status?: string
  length?: number
  chunks_count?: number
  chunks?: number
  created_at?: string
  updated_at?: string
  error_msg?: string
  metadata?: Record<string, unknown>
  track_id?: string
}

type DocumentsResponse = {
  documents?: DocumentRecord[]
  pagination?: {
    page?: number
    page_size?: number
    total_count?: number
    total_pages?: number
  }
  status_counts?: Record<string, number>
}

type PipelineStatus = {
  busy?: boolean
  scanning?: boolean
  job_name?: string
  docs?: number
  batchs?: number
  cur_batch?: number
  latest_message?: string
  history_messages?: string[]
}

type RagConfig = {
  status?: 'valid' | 'invalid'
  issues?: string[]
  llm?: {
    binding?: string
    host?: string
    model?: string
    api_key?: string
  }
  embedding?: {
    binding?: string
    host?: string
    model?: string
    api_key?: string
  }
}

type GraphNode = {
  id?: string
  labels?: string[]
  properties?: Record<string, unknown>
}

type GraphEdge = {
  id?: string
  source?: string
  target?: string
  type?: string
  properties?: Record<string, unknown>
}

type VisualNode = GraphNode & {
  id: string
  x: number
  y: number
  degree: number
  radius: number
  color: string
}

type VisualEdge = GraphEdge & {
  source: string
  target: string
}

type QueryMode = 'mix' | 'hybrid' | 'local' | 'global' | 'naive' | 'bypass'
type QueryResponse = {
  response?: string
  references?: Array<{ reference_id?: string; file_path?: string; content?: string[] }>
}

const tokenKey = 'LIGHTRAG_PLATFORM_TOKEN'
const documentStatuses = ['ALL', 'PENDING', 'PARSING', 'ANALYZING', 'PROCESSING', 'PROCESSED', 'FAILED']
const queryModes: QueryMode[] = ['mix', 'hybrid', 'local', 'global', 'naive', 'bypass']

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

function safeString(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function getGraphNodes(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') return []
  const graph = data as Record<string, unknown>
  const nodes = graph.nodes || graph.vertices || graph.entities
  return Array.isArray(nodes) ? nodes : []
}

function getGraphEdges(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') return []
  const graph = data as Record<string, unknown>
  const edges = graph.edges || graph.links || graph.relations || graph.relationships
  return Array.isArray(edges) ? edges : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function graphNodeLabel(node: GraphNode): string {
  return safeString(node.id || node.properties?.entity_id || node.labels?.[0])
}

function graphNodeType(node: GraphNode): string {
  return safeString(node.properties?.entity_type || node.labels?.[0], 'entity')
}

function hashText(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function colorForType(type: string): string {
  const palette = ['#2563eb', '#dc2626', '#059669', '#7c3aed', '#d97706', '#0891b2', '#be123c', '#4338ca']
  return palette[hashText(type) % palette.length]
}

function normalizeGraph(graph: unknown): { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean } {
  const graphRecord = asRecord(graph)
  const nodes = getGraphNodes(graph).map((item) => asRecord(item) as GraphNode).filter((node) => graphNodeLabel(node) !== '-')
  const edges = getGraphEdges(graph)
    .map((item) => asRecord(item) as GraphEdge)
    .filter((edge) => edge.source && edge.target)
  return {
    nodes,
    edges,
    truncated: Boolean(graphRecord.is_truncated)
  }
}

function buildGraphLayout(graph: unknown): { nodes: VisualNode[]; edges: VisualEdge[]; truncated: boolean } {
  const normalized = normalizeGraph(graph)
  const width = 1180
  const height = 620
  const centerX = width / 2
  const centerY = height / 2
  const nodeMap = new Map<string, VisualNode>()
  const degree = new Map<string, number>()

  normalized.edges.forEach((edge) => {
    if (!edge.source || !edge.target) return
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1)
  })

  normalized.nodes.forEach((node, index) => {
    const id = graphNodeLabel(node)
    const angle = index * 2.399963229728653 + (hashText(id) % 90) / 90
    const distance = 34 + Math.sqrt(index + 1) * 24
    const nodeDegree = degree.get(id) || 0
    nodeMap.set(id, {
      ...node,
      id,
      x: centerX + Math.cos(angle) * distance,
      y: centerY + Math.sin(angle) * distance,
      degree: nodeDegree,
      radius: Math.max(5, Math.min(18, 5 + Math.sqrt(nodeDegree) * 2.6)),
      color: colorForType(graphNodeType(node))
    })
  })

  const edges = normalized.edges
    .filter((edge): edge is VisualEdge => Boolean(edge.source && edge.target && nodeMap.has(edge.source) && nodeMap.has(edge.target)))

  const nodes = Array.from(nodeMap.values())
  for (let tick = 0; tick < 130; tick += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]
        const b = nodes[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distSq = Math.max(64, dx * dx + dy * dy)
        const force = Math.min(2.2, 280 / distSq)
        const dist = Math.sqrt(distSq)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.x -= fx
        a.y -= fy
        b.x += fx
        b.y += fy
      }
    }

    edges.forEach((edge) => {
      const source = nodeMap.get(edge.source)
      const target = nodeMap.get(edge.target)
      if (!source || !target) return
      const dx = target.x - source.x
      const dy = target.y - source.y
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      const desired = 76 + Math.min(80, (source.radius + target.radius) * 2)
      const force = (distance - desired) * 0.018
      const fx = (dx / distance) * force
      const fy = (dy / distance) * force
      source.x += fx
      source.y += fy
      target.x -= fx
      target.y -= fy
    })

    nodes.forEach((node) => {
      node.x += (centerX - node.x) * 0.004
      node.y += (centerY - node.y) * 0.004
      node.x = Math.max(40, Math.min(width - 40, node.x))
      node.y = Math.max(40, Math.min(height - 40, node.y))
    })
  }

  return { nodes, edges, truncated: normalized.truncated }
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
            <input value={username} onChange={(event: ChangeEvent<HTMLInputElement>) => setUsername(event.target.value)} />
          </label>
          <label>
            密码
            <input type="password" value={password} onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)} />
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
        <NavButton id="documents" view={view} setView={setView} icon={<FileText />} label="知识库" />
        <NavButton id="knowledge-graph" view={view} setView={setView} icon={<Network />} label="知识图谱" />
        <NavButton id="retrieval" view={view} setView={setView} icon={<Search />} label="检索" />
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
        {view === 'knowledge-graph' && <KnowledgeGraph />}
        {view === 'retrieval' && <Retrieval />}
        {view === 'users' && user.role === 'admin' && <UsersAdmin />}
      </main>
    </div>
  )
}

function NavButton(props: {
  id: string
  view: string
  setView: (view: string) => void
  icon: UINode
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
      <PageHeader title="概览" subtitle="当前平台保持外置套壳架构，用户数据由独立 LightRAG runtime 和 workspace 隔离。" />
      <div className="stat-grid">
        <Stat title="当前用户" value={user.username} hint={user.workspace_id} />
        <Stat title="Platform" value={platform?.status || '检查中'} hint={platform?.runtime_mode || ''} />
        <Stat title="LightRAG" value={(rag?.status as string) || '检查中'} hint={`WebUI: ${String(rag?.webui_available ?? '-')}`} />
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="panel">
        <h3>功能入口</h3>
        <div className="feature-list">
          <span>知识库：上传、扫描、状态筛选和文档列表</span>
          <span>知识图谱：标签检索、热门标签和子图数据</span>
          <span>检索：多模式问答与结构化检索结果</span>
        </div>
      </div>
    </section>
  )
}

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="page-header">
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
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

function Message({ value, tone = 'info' }: { value: string; tone?: 'info' | 'error' }) {
  if (!value) return null
  return <div className={tone === 'error' ? 'error-box' : 'notice-box'}>{value}</div>
}

function JsonBlock({ data }: { data: unknown }) {
  if (data === null || data === undefined) return null
  return <pre className="console">{typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</pre>
}

function Documents() {
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [documents, setDocuments] = useState<DocumentsResponse>({})
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null)
  const [ragConfig, setRagConfig] = useState<RagConfig | null>(null)
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [uploadOpen, setUploadOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  async function loadDocuments(nextPage = page, nextStatus = status) {
    setLoading(true)
    setError('')
    try {
      const body: Record<string, unknown> = {
        page: nextPage,
        page_size: 50,
        sort_field: 'updated_at',
        sort_direction: 'desc'
      }
      if (nextStatus !== 'ALL') body.status_filters = [nextStatus]
      const [docs, pipe, config] = await Promise.all([
        api<DocumentsResponse>('/api/lightrag/documents/paginated', {
          method: 'POST',
          body: JSON.stringify(body)
        }),
        api<PipelineStatus>('/api/lightrag/documents/pipeline_status').catch(() => null),
        api<RagConfig>('/api/rag/config').catch(() => null)
      ])
      setDocuments(docs)
      setPipeline(pipe)
      setRagConfig(config)
      setPage(nextPage)
      const visibleIds = new Set((docs.documents || []).map((doc) => doc.id).filter(Boolean))
      setSelectedDocIds((previous) => previous.filter((id) => visibleIds.has(id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文档失败')
    } finally {
      setLoading(false)
    }
  }

  async function upload() {
    if (!file) return
    if (ragConfig?.status === 'invalid') {
      setError(`模型配置无效：${ragConfig.issues?.join('；') || '请检查 LightRAG .env'}`)
      return
    }
    const form = new FormData()
    form.append('file', file)
    setLoading(true)
    setMessage('上传中...')
    setError('')
    try {
      const result = await api<{ message?: string; track_id?: string }>('/api/lightrag/documents/upload', {
        method: 'POST',
        body: form
      })
      setMessage(`${result.message || '文件已提交处理'}${result.track_id ? ` Track ID: ${result.track_id}` : ''}`)
      setUploadOpen(false)
      setFile(null)
      await loadDocuments(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setLoading(false)
    }
  }

  async function scan() {
    setLoading(true)
    setMessage('')
    setError('')
    try {
      const result = await api<{ status?: string; message?: string; track_id?: string }>('/api/lightrag/documents/scan', {
        method: 'POST'
      })
      setMessage(`${result.status || 'scan'}：${result.message || '扫描已触发'}${result.track_id ? ` Track ID: ${result.track_id}` : ''}`)
      await loadDocuments(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败')
    } finally {
      setLoading(false)
    }
  }

  async function deleteSelectedDocuments() {
    if (selectedDocIds.length === 0) return
    const ok = window.confirm(`确定删除选中的 ${selectedDocIds.length} 个文档吗？该操作会删除文档记录、向量索引、图谱关联和源文件。`)
    if (!ok) return
    setLoading(true)
    setMessage('')
    setError('')
    try {
      const result = await api<{ status?: string; message?: string }>('/api/lightrag/documents/delete_document', {
        method: 'DELETE',
        body: JSON.stringify({
          doc_ids: selectedDocIds,
          delete_file: true,
          delete_llm_cache: true
        })
      })
      setMessage(result.message || '删除任务已提交')
      setSelectedDocIds([])
      window.setTimeout(() => loadDocuments(1), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDocuments(1)
  }, [])

  const rows = documents.documents || []
  const counts = documents.status_counts || {}
  const total = documents.pagination?.total_count ?? rows.length
  const totalPages = documents.pagination?.total_pages ?? 1
  const configError = ragConfig?.status === 'invalid'
    ? `模型配置无效，文档可以上传但无法完成入库处理：${ragConfig.issues?.join('；') || '请检查 LightRAG .env'}`
    : ''
  const visibleDocIds = rows.map((doc) => doc.id).filter((id): id is string => Boolean(id))
  const allVisibleSelected = visibleDocIds.length > 0 && visibleDocIds.every((id) => selectedDocIds.includes(id))

  function toggleDocument(docId: string | undefined) {
    if (!docId) return
    setSelectedDocIds((previous) => previous.includes(docId) ? previous.filter((id) => id !== docId) : [...previous, docId])
  }

  function toggleAllVisible() {
    setSelectedDocIds((previous) => {
      if (allVisibleSelected) return previous.filter((id) => !visibleDocIds.includes(id))
      return Array.from(new Set([...previous, ...visibleDocIds]))
    })
  }

  function selectUploadFile(nextFile: File | undefined | null) {
    if (!nextFile) return
    setFile(nextFile)
    setError('')
  }

  return (
    <section>
      <PageHeader title="知识库" subtitle="参照原生 Document Management，保留上传、扫描、Pipeline 状态和文档状态列表。" />
      <div className="toolbar panel">
        <div className="upload-summary">
          <Upload size={20} />
          <span>{file ? file.name : 'No file selected'}</span>
        </div>
        <button onClick={() => setUploadOpen(true)} disabled={loading || ragConfig?.status === 'invalid'}>
          <Upload size={17} />
          Upload
        </button>
        <button className="secondary" onClick={scan} disabled={loading}>
          <ListRestart size={17} />
          Scan/Retry
        </button>
        <button className="secondary" onClick={() => loadDocuments(page)} disabled={loading}>
          <RefreshCcw size={17} />
          Refresh
        </button>
        <button className="danger" onClick={deleteSelectedDocuments} disabled={loading || selectedDocIds.length === 0 || Boolean(pipeline?.busy)}>
          <Trash2 size={17} />
          Delete ({selectedDocIds.length})
        </button>
      </div>
      <Message value={configError} tone="error" />
      {ragConfig && (
        <div className="config-strip">
          <span>LLM: {safeString(ragConfig.llm?.binding)} / {safeString(ragConfig.llm?.model)}</span>
          <span>Embedding: {safeString(ragConfig.embedding?.binding)} / {safeString(ragConfig.embedding?.model)}</span>
        </div>
      )}
      <Message value={message} />
      <Message value={error} tone="error" />
      {uploadOpen && (
        <div className="modal-backdrop" onClick={() => setUploadOpen(false)}>
          <div className="upload-modal" onClick={(event: any) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setUploadOpen(false)}>×</button>
            <h3>Upload Documents</h3>
            <p>Drag and drop your documents here or click to browse.</p>
            <label
              className={dragActive ? 'drop-zone active' : 'drop-zone'}
              onDragOver={(event: any) => {
                event.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event: any) => {
                event.preventDefault()
                setDragActive(false)
                selectUploadFile(event.dataTransfer?.files?.[0])
              }}
            >
              <Upload size={34} />
              <strong>{file ? file.name : 'Drag and drop files here, or click to select files'}</strong>
              <span>Supported types: TXT, MD, MDX, DOCX, PDF, PPTX, XLSX, RTF, ODT, EPUB, HTML, HTM, TEX, JSON, XML, YAML, YML, CSV, LOG, CONF, INI, PROPERTIES, SQL, BAT, SH, C, H, CPP, HPP, PY, JAVA, JS, TS, SWIFT, GO, RB, PHP, CSS, SCSS, LESS</span>
              <input
                type="file"
                accept=".txt,.md,.mdx,.docx,.pdf,.pptx,.xlsx,.rtf,.odt,.epub,.html,.htm,.tex,.json,.xml,.yaml,.yml,.csv,.log,.conf,.ini,.properties,.sql,.bat,.sh,.c,.h,.cpp,.hpp,.py,.java,.js,.ts,.swift,.go,.rb,.php,.css,.scss,.less"
                onChange={(event: ChangeEvent<HTMLInputElement>) => selectUploadFile(event.target.files?.[0])}
              />
            </label>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setUploadOpen(false)}>Cancel</button>
              <button onClick={upload} disabled={!file || loading || ragConfig?.status === 'invalid'}>
                {loading ? <Loader2 className="spin" size={17} /> : <Upload size={17} />}
                Upload
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="stat-grid compact">
        <Stat title="Total" value={String(total)} hint="documents" />
        <Stat title="Pipeline" value={pipeline?.busy ? 'busy' : 'idle'} hint={pipeline?.job_name || pipeline?.latest_message || 'ready'} />
        <Stat title="Current Filter" value={status} hint={`page ${page}/${totalPages}`} />
      </div>
      <div className="tabs">
        {documentStatuses.map((item) => (
          <button
            key={item}
            className={status === item ? 'tab active' : 'tab'}
            onClick={() => {
              setStatus(item)
              loadDocuments(1, item)
            }}
          >
            {item === 'ALL' ? `All (${total})` : `${item} (${counts[item] || 0})`}
          </button>
        ))}
      </div>
      <div className="data-table">
        <div className="data-head document-grid">
          <label className="select-cell" title="选择当前页文档">
            <input type="checkbox" checked={allVisibleSelected} disabled={visibleDocIds.length === 0} onChange={toggleAllVisible} />
          </label>
          <span>ID</span>
          <span>Summary</span>
          <span>Status</span>
          <span>Length</span>
          <span>Chunks</span>
          <span>Updated</span>
        </div>
        {rows.length === 0 && <div className="empty">暂无文档</div>}
        {rows.map((doc, index) => (
          <div className="data-row document-grid" key={doc.id || `${doc.file_path}-${index}`}>
            <label className="select-cell" title="选择文档">
              <input
                type="checkbox"
                checked={Boolean(doc.id && selectedDocIds.includes(doc.id))}
                disabled={!doc.id || loading}
                onChange={() => toggleDocument(doc.id)}
              />
            </label>
            <code title={doc.id || doc.file_path}>{safeString(doc.id || doc.file_path)}</code>
            <span title={doc.summary || doc.file_path}>{safeString(doc.summary || doc.file_path)}</span>
            <span className={`status-pill ${String(doc.status || '').toLowerCase()}`} title={doc.error_msg || doc.status}>{safeString(doc.status)}</span>
            <span>{safeString(doc.length)}</span>
            <span>{safeString(doc.chunks_count ?? doc.chunks)}</span>
            <span>{safeString(doc.updated_at || doc.created_at)}</span>
            {doc.error_msg && <span className="doc-error">{doc.error_msg}</span>}
          </div>
        ))}
      </div>
      <div className="pager">
        <button className="secondary" disabled={page <= 1 || loading} onClick={() => loadDocuments(page - 1)}>
          上一页
        </button>
        <span>{page} / {totalPages}</span>
        <button className="secondary" disabled={page >= totalPages || loading} onClick={() => loadDocuments(page + 1)}>
          下一页
        </button>
      </div>
    </section>
  )
}

function KnowledgeGraph() {
  const [label, setLabel] = useState('*')
  const [searchText, setSearchText] = useState('')
  const [nodeSearch, setNodeSearch] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const [graph, setGraph] = useState<unknown>(null)
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  async function loadLabels(kind: 'all' | 'popular' | 'search' = 'all') {
    setLoading(true)
    setError('')
    try {
      const path =
        kind === 'popular'
          ? '/api/lightrag/graph/label/popular?limit=50'
          : kind === 'search'
            ? `/api/lightrag/graph/label/search?q=${encodeURIComponent(searchText)}&limit=50`
            : '/api/lightrag/graph/label/list'
      const result = await api<string[]>(path)
      setLabels(Array.isArray(result) ? result : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载标签失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadGraph(nextLabel = label) {
    const value = nextLabel.trim()
    if (!value) {
      setError('请先选择或输入一个图谱标签')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await api<unknown>(`/api/lightrag/graphs?label=${encodeURIComponent(value)}&max_depth=3&max_nodes=1000`)
      setGraph(result)
      setSelectedNodeId('')
      setZoom(1)
      setPan({ x: 0, y: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载图谱失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLabels('popular')
    loadGraph('*')
  }, [])

  const graphLayout = useMemo(() => buildGraphLayout(graph), [graph])
  const nodes = graphLayout.nodes
  const edges = graphLayout.edges
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null
  const searchNeedle = nodeSearch.trim().toLowerCase()
  const highlightedIds = useMemo(() => {
    if (!searchNeedle) return new Set<string>()
    return new Set(nodes.filter((node) => node.id.toLowerCase().includes(searchNeedle)).map((node) => node.id))
  }, [nodes, searchNeedle])
  const connectedIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>()
    const ids = new Set<string>([selectedNodeId])
    edges.forEach((edge) => {
      if (edge.source === selectedNodeId) ids.add(edge.target)
      if (edge.target === selectedNodeId) ids.add(edge.source)
    })
    return ids
  }, [edges, selectedNodeId])

  function nodeOpacity(nodeId: string): number {
    if (selectedNodeId && !connectedIds.has(nodeId)) return 0.22
    if (searchNeedle && !highlightedIds.has(nodeId)) return 0.22
    return 1
  }

  function edgeOpacity(edge: VisualEdge): number {
    if (selectedNodeId && edge.source !== selectedNodeId && edge.target !== selectedNodeId) return 0.12
    if (searchNeedle && !highlightedIds.has(edge.source) && !highlightedIds.has(edge.target)) return 0.08
    return 0.45
  }

  function resetGraphView() {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setSelectedNodeId('')
  }

  function handleWheel(event: any) {
    event.preventDefault()
    setZoom((value) => Math.max(0.45, Math.min(2.8, value + (event.deltaY < 0 ? 0.12 : -0.12))))
  }

  function handlePointerDown(event: any) {
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handlePointerMove(event: any) {
    if (!dragRef.current) return
    setPan({
      x: dragRef.current.panX + event.clientX - dragRef.current.x,
      y: dragRef.current.panY + event.clientY - dragRef.current.y
    })
  }

  function handlePointerUp() {
    dragRef.current = null
  }

  return (
    <section>
      <PageHeader title="知识图谱" subtitle="参照原生 Knowledge Graph，提供可缩放、可拖拽、可检索的图形化知识图谱。" />
      <div className="panel kg-layout">
        <div className="kg-controls">
          <label>
            图谱范围
            <input value={label} onChange={(event: ChangeEvent<HTMLInputElement>) => setLabel(event.target.value)} placeholder="* 或输入实体标签" />
          </label>
          <div className="row">
            <button onClick={() => loadGraph()} disabled={loading || !label.trim()}>
              <Network size={17} />
              Load Graph
            </button>
            <button className="secondary" onClick={() => loadLabels('popular')} disabled={loading}>
              Popular
            </button>
            <button className="secondary" onClick={() => loadLabels('all')} disabled={loading}>
              All Labels
            </button>
          </div>
          <label>
            页面内节点搜索
            <input value={nodeSearch} onChange={(event: ChangeEvent<HTMLInputElement>) => setNodeSearch(event.target.value)} placeholder="Search nodes in graph" />
          </label>
          <label>
            搜索标签
            <div className="inline-input">
              <input value={searchText} onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)} placeholder="Search label" />
              <button className="secondary" onClick={() => loadLabels('search')} disabled={loading || !searchText.trim()}>
                <Search size={17} />
              </button>
            </div>
          </label>
        </div>
        <div className="label-cloud">
          {labels.length === 0 && <span className="muted">暂无标签</span>}
          <button
            className={label === '*' ? 'label-chip active' : 'label-chip'}
            onClick={() => {
              setLabel('*')
              loadGraph('*')
            }}
          >
            *
          </button>
          {labels.slice(0, 120).map((item) => (
            <button
              className={label === item ? 'label-chip active' : 'label-chip'}
              key={item}
              onClick={() => {
                setLabel(item)
                loadGraph(item)
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <Message value={error} tone="error" />
      <div className="stat-grid compact">
        <Stat title="Nodes" value={String(nodes.length)} hint={label || 'no label selected'} />
        <Stat title="Edges" value={String(edges.length)} hint="relations" />
        <Stat title="Labels" value={String(labels.length)} hint={graphLayout.truncated ? 'truncated' : 'loaded'} />
      </div>
      <div className="graph-workbench">
        <div className="graph-toolbar">
          <button className="secondary" onClick={() => setZoom((value) => Math.min(2.8, value + 0.15))}>
            <ZoomIn size={17} />
          </button>
          <button className="secondary" onClick={() => setZoom((value) => Math.max(0.45, value - 0.15))}>
            <ZoomOut size={17} />
          </button>
          <button className="secondary" onClick={resetGraphView}>
            <Maximize2 size={17} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
        </div>
        <div className="graph-canvas-wrap">
          {nodes.length === 0 && <div className="empty graph-empty">暂无图谱数据，请选择 `*` 或其他实体标签。</div>}
          <svg
            className="graph-canvas"
            viewBox="0 0 1180 620"
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              <g>
                {edges.map((edge) => {
                  const source = nodes.find((node) => node.id === edge.source)
                  const target = nodes.find((node) => node.id === edge.target)
                  if (!source || !target) return null
                  return (
                    <line
                      key={edge.id || `${edge.source}-${edge.target}`}
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      className="graph-edge"
                      style={{ opacity: edgeOpacity(edge) }}
                    />
                  )
                })}
              </g>
              <g>
                {nodes.map((node) => {
                  const isSelected = node.id === selectedNodeId
                  const isHighlighted = highlightedIds.has(node.id)
                  const showLabel = isSelected || isHighlighted || node.degree >= 5 || nodes.length <= 45
                  return (
                    <g
                      key={node.id}
                      className={isSelected ? 'graph-node selected' : 'graph-node'}
                      transform={`translate(${node.x} ${node.y})`}
                      style={{ opacity: nodeOpacity(node.id) }}
                      onPointerDown={(event: any) => event.stopPropagation()}
                      onClick={() => setSelectedNodeId(node.id)}
                    >
                      <circle r={node.radius} fill={node.color} />
                      {showLabel && <text x={node.radius + 6} y="4">{node.id}</text>}
                    </g>
                  )
                })}
              </g>
            </g>
          </svg>
        </div>
        <aside className="graph-detail">
          <h3>{selectedNode ? selectedNode.id : '节点详情'}</h3>
          {selectedNode ? (
            <>
              <div className="detail-row"><span>Type</span><strong>{graphNodeType(selectedNode)}</strong></div>
              <div className="detail-row"><span>Degree</span><strong>{selectedNode.degree}</strong></div>
              <p>{safeString(selectedNode.properties?.description, '暂无描述')}</p>
              <JsonBlock data={selectedNode.properties || selectedNode} />
            </>
          ) : (
            <p className="muted">点击图中的节点查看实体类型、关联数量和描述。</p>
          )}
        </aside>
      </div>
    </section>
  )
}

function Retrieval() {
  const [question, setQuestion] = useState('输入检索内容')
  const [mode, setMode] = useState<QueryMode>('mix')
  const [topK, setTopK] = useState(60)
  const [chunkTopK, setChunkTopK] = useState(20)
  const [includeReferences, setIncludeReferences] = useState(true)
  const [includeChunkContent, setIncludeChunkContent] = useState(false)
  const [answer, setAnswer] = useState<QueryResponse | null>(null)
  const [retrievalData, setRetrievalData] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const requestBody = useMemo(
    () => ({
      query: question,
      mode,
      top_k: topK,
      chunk_top_k: chunkTopK,
      include_references: includeReferences,
      include_chunk_content: includeChunkContent
    }),
    [chunkTopK, includeChunkContent, includeReferences, mode, question, topK]
  )

  async function ask(endpoint: 'query' | 'data') {
    if (question.trim().length < 3) {
      setError('问题至少需要 3 个字符')
      return
    }
    setLoading(true)
    setError('')
    try {
      if (endpoint === 'query') {
        setAnswer(await api<QueryResponse>('/api/lightrag/query', {
          method: 'POST',
          body: JSON.stringify(requestBody)
        }))
      } else {
        setRetrievalData(await api<unknown>('/api/lightrag/query/data', {
          method: 'POST',
          body: JSON.stringify(requestBody)
        }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '检索失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section>
      <PageHeader title="检索" subtitle="参照原生 Retrieval，支持多种 LightRAG 查询模式、引用开关和结构化检索数据。" />
      <div className="panel retrieval-grid">
        <label className="question-box">
          Query
          <textarea value={question} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setQuestion(event.target.value)} />
        </label>
        <div className="settings-grid">
          <label>
            Mode
            <select value={mode} onChange={(event: ChangeEvent<HTMLSelectElement>) => setMode(event.target.value as QueryMode)}>
              {queryModes.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Top K
            <input type="number" min={1} max={200} value={topK} onChange={(event: ChangeEvent<HTMLInputElement>) => setTopK(Number(event.target.value))} />
          </label>
          <label>
            Chunk Top K
            <input type="number" min={1} max={200} value={chunkTopK} onChange={(event: ChangeEvent<HTMLInputElement>) => setChunkTopK(Number(event.target.value))} />
          </label>
          <label className="check-line">
            <input type="checkbox" checked={includeReferences} onChange={(event: ChangeEvent<HTMLInputElement>) => setIncludeReferences(event.target.checked)} />
            References
          </label>
          <label className="check-line">
            <input type="checkbox" checked={includeChunkContent} onChange={(event: ChangeEvent<HTMLInputElement>) => setIncludeChunkContent(event.target.checked)} />
            Chunk Content
          </label>
        </div>
        <div className="row action-row">
          <button onClick={() => ask('query')} disabled={loading}>
            {loading ? <Loader2 className="spin" size={17} /> : <Search size={17} />}
            Query
          </button>
          <button className="secondary" onClick={() => ask('data')} disabled={loading}>
            <Braces size={17} />
            Query Data
          </button>
        </div>
      </div>
      <Message value={error} tone="error" />
      {answer && (
        <div className="panel answer-panel">
          <h3>Response</h3>
          <p>{answer.response || JSON.stringify(answer)}</p>
          {answer.references && answer.references.length > 0 && (
            <>
              <h3>References</h3>
              <div className="reference-list">
                {answer.references.map((item, index) => (
                  <div className="reference-item" key={`${item.reference_id}-${index}`}>
                    <strong>{item.reference_id || index + 1}</strong>
                    <span>{item.file_path || '-'}</span>
                    {item.content && <small>{item.content.join('\n\n')}</small>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {retrievalData !== null && (
        <div className="panel">
          <h3>Structured Retrieval Data</h3>
          <JsonBlock data={retrievalData} />
        </div>
      )}
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
      <PageHeader title="用户管理" subtitle="管理员维护平台账号，每个账号映射到独立 LightRAG workspace。" />
      <div className="stat-grid">
        <Stat title="用户总数" value={String(users.length)} hint="Platform DB" />
        <Stat title="启用用户" value={String(activeUsers)} hint="active" />
        <Stat title="隔离策略" value="user_id" hint="user_{id}" />
      </div>
      <form className="panel user-form" onSubmit={createUser}>
        <Shield size={20} />
        <input placeholder="用户名" value={username} onChange={(event: ChangeEvent<HTMLInputElement>) => setUsername(event.target.value)} />
        <input placeholder="初始密码（至少 6 位）" type="password" value={password} onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)} />
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
