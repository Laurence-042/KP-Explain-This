import { ref } from 'vue'
import { tokenize } from '../core/tokenizer'

/**
 * 书库：正文存 IndexedDB（localStorage 放不下整本书）。
 * - TXT：UTF-8 严格解码，失败回退 GBK（中文 TXT 常见编码）
 * - PDF：pdfjs 按页抽取文本（懒加载 worker，只在导入 PDF 时下载）
 */

const DB_NAME = 'kpet-books'
const STORE = 'books'

export type StoredBook = {
  id: string
  name: string
  source: 'txt' | 'pdf'
  /** TXT 全文 */
  text?: string
  /** PDF 各页抽取文本 */
  pageTexts?: string[]
  /** 词总数（TXT：估算虚拟页数用；PDF：统计信息） */
  wordCount: number
  addedAt: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = fn(tx.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    tx.oncomplete = () => db.close()
  })
}

function newId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** 读取 TXT 文件：UTF-8 优先，乱码/失败回退 GBK */
export async function readTextFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('gbk').decode(buffer)
  }
}

/** pdfjs 逐页抽取文本：按 y 坐标重组行、行内按 x 排序 */
async function extractPdfPageTexts(file: File): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const lines = new Map<number, Array<{ x: number; str: string }>>()
    for (const raw of content.items) {
      if (!('str' in raw) || !raw.str) continue
      const item = raw as { str: string; transform: number[] }
      const y = Math.round(item.transform[5] / 2) * 2
      const x = item.transform[4]
      const bucket = lines.get(y) ?? []
      bucket.push({ x, str: item.str })
      lines.set(y, bucket)
    }
    const text = [...lines.entries()]
      .sort((a, b) => b[0] - a[0]) // PDF 坐标系 y 向上
      .map(([, parts]) =>
        parts
          .sort((a, b) => a.x - b.x)
          .map((p) => p.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter(Boolean)
      .join('\n')
    pages.push(text)
  }
  return pages
}

function countWords(texts: string[]): number {
  let n = 0
  for (const t of texts) n += tokenize(t).length
  return n
}

/**
 * 把任意来源的记录归一化为当前 StoredBook 格式。
 * 兼容 v1 旧格式（无 source/wordCount，只有 text）——缺 source 一律视为 txt。
 */
export function normalizeStoredBook(raw: unknown): StoredBook | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Partial<StoredBook>
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null
  const addedAt = typeof r.addedAt === 'string' ? r.addedAt : ''
  if (r.source === 'pdf') {
    return {
      id: r.id,
      name: r.name,
      source: 'pdf',
      pageTexts: Array.isArray(r.pageTexts) ? r.pageTexts : [],
      wordCount: typeof r.wordCount === 'number' ? r.wordCount : 0,
      addedAt,
    }
  }
  return {
    id: r.id,
    name: r.name,
    source: 'txt',
    text: typeof r.text === 'string' ? r.text : '',
    wordCount: typeof r.wordCount === 'number' ? r.wordCount : 0,
    addedAt,
  }
}

/** 记录是否需要迁移回写（旧格式缺 source / wordCount） */
function needsMigration(raw: unknown): boolean {
  const r = raw as Partial<StoredBook>
  return r.source === undefined || r.wordCount === undefined
}

export function useBooks() {
  const books = ref<StoredBook[]>([])
  const importing = ref(false)

  async function refresh(): Promise<void> {
    const all = await withStore<unknown[]>('readonly', (s) => s.getAll() as IDBRequest<unknown[]>)
    const normalized = all
      .map((raw) => ({ raw, book: normalizeStoredBook(raw) }))
      .filter((x): x is { raw: unknown; book: StoredBook } => x.book !== null)

    // 旧格式记录：归一化后回写（补 source/wordCount），下次读取即为新格式
    const legacy = normalized.filter((x) => needsMigration(x.raw))
    if (legacy.length > 0) {
      void (async () => {
        for (const { book } of legacy) {
          if (!book.wordCount) {
            book.wordCount = countWords(
              book.source === 'pdf' ? (book.pageTexts ?? []) : [book.text ?? ''],
            )
          }
          await withStore('readwrite', (s) => s.put(book))
        }
        await refresh()
      })()
    }

    books.value = normalized
      .map((x) => x.book)
      .sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''))
  }

  async function importFile(file: File): Promise<StoredBook> {
    importing.value = true
    try {
      const isPdf = file.name.toLowerCase().endsWith('.pdf')
      let book: StoredBook
      if (isPdf) {
        const pageTexts = await extractPdfPageTexts(file)
        if (pageTexts.every((p) => !p.trim())) throw new Error('pdf has no extractable text')
        book = {
          id: newId(),
          name: file.name.replace(/\.pdf$/i, ''),
          source: 'pdf',
          pageTexts,
          wordCount: countWords(pageTexts),
          addedAt: new Date().toISOString(),
        }
      } else {
        const text = await readTextFile(file)
        if (!text.trim()) throw new Error('empty file')
        book = {
          id: newId(),
          name: file.name.replace(/\.[^.]+$/, ''),
          source: 'txt',
          text,
          wordCount: countWords([text]),
          addedAt: new Date().toISOString(),
        }
      }
      await withStore('readwrite', (s) => s.put(book))
      await refresh()
      return book
    } finally {
      importing.value = false
    }
  }

  async function getBook(id: string): Promise<StoredBook | undefined> {
    const raw = await withStore<unknown>(
      'readonly',
      (s) => s.get(id) as IDBRequest<unknown>,
    )
    return normalizeStoredBook(raw) ?? undefined
  }

  /** 存档导入时批量写入（缺词数统计时补算） */
  async function putBook(book: StoredBook): Promise<void> {
    if (!book.wordCount) {
      book.wordCount = countWords(
        book.source === 'pdf' ? (book.pageTexts ?? []) : [book.text ?? ''],
      )
    }
    await withStore('readwrite', (s) => s.put(book))
    await refresh()
  }

  async function removeBook(id: string): Promise<void> {
    await withStore('readwrite', (s) => s.delete(id))
    await refresh()
  }

  return { books, importing, refresh, importFile, getBook, putBook, removeBook }
}
