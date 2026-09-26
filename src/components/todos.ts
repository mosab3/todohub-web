/**
 * Todo model and localStorage persistence.
 *
 * Tasks carry a stable `id` so list operations never depend on array indexes,
 * and each task owns a one-level sub-list of steps. A task may also belong to
 * one category, stored by id and resolved against the separate category list.
 */

export interface Subtask {
  id: string
  text: string
  checked: boolean
}

export interface Todo {
  id: string
  text: string
  checked: boolean
  subtasks: Subtask[]
  /** Category id, or null for an uncategorised task. */
  categoryId: string | null
}

/**
 * Fixed palette. Categories store the key, not a colour value, so each one
 * keeps a readable contrast when the theme flips (see `--cat-*` in globals.css).
 */
export const CATEGORY_COLORS = [
  'indigo',
  'sky',
  'teal',
  'lime',
  'amber',
  'rose',
  'violet',
  'slate',
] as const

export type CategoryColor = (typeof CATEGORY_COLORS)[number]

export interface Category {
  id: string
  name: string
  color: CategoryColor
}

export const MAX_CATEGORY_NAME = 24

/** Keeps the chip rail readable and the QR payload from exploding. */
export const MAX_CATEGORIES = 12

const STORAGE_KEY = '***'
const CATEGORY_STORAGE_KEY = 'todohub.categories'

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/* Categories -------------------------------------------------------------- */

/** Resolves a palette key to the themed CSS variable that holds its colour. */
export function categoryColorVar(color: CategoryColor): string {
  return `var(--cat-${color})`
}

/**
 * Picks the least-used colour, earliest in the palette, so a new category is
 * visually distinct from the existing ones until the palette wraps around.
 */
export function nextCategoryColor(existing: Category[]): CategoryColor {
  const counts = new Map<CategoryColor, number>(CATEGORY_COLORS.map((color) => [color, 0]))
  for (const category of existing) {
    counts.set(category.color, (counts.get(category.color) ?? 0) + 1)
  }
  return CATEGORY_COLORS.reduce((best, color) =>
    (counts.get(color) ?? 0) < (counts.get(best) ?? 0) ? color : best,
  )
}

/** Trims and clamps a typed category name. Returns '' when there is nothing left. */
export function cleanCategoryName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_CATEGORY_NAME)
}

/** Categories are matched case-insensitively so "Work" and "work" cannot coexist. */
export function findCategoryByName(
  categories: Category[],
  name: string,
): Category | undefined {
  const key = name.toLowerCase()
  return categories.find((category) => category.name.toLowerCase() === key)
}

export function normalizeCategories(input: unknown): Category[] {
  if (!Array.isArray(input)) return []

  const seen = new Set<string>()
  const categories: Category[] = []

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue
    if (categories.length >= MAX_CATEGORIES) break

    const candidate = entry as Partial<Category>
    const name = cleanCategoryName(typeof candidate.name === 'string' ? candidate.name : '')
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())

    const color =
      typeof candidate.color === 'string' &&
      (CATEGORY_COLORS as readonly string[]).includes(candidate.color)
        ? (candidate.color as CategoryColor)
        : CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length]

    categories.push({
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId(),
      name,
      color,
    })
  }

  return categories
}

/* Todos ------------------------------------------------------------------- */

/** Coerce unknown sub-list input (storage or a scanned QR payload) into steps. */
function normalizeSubtasks(input: unknown): Subtask[] {
  if (!Array.isArray(input)) return []

  const seen = new Set<string>()
  const subtasks: Subtask[] = []

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue

    const candidate = entry as Partial<Subtask>
    const text = typeof candidate.text === 'string' ? candidate.text.trim() : ''
    if (!text || seen.has(text)) continue
    seen.add(text)

    subtasks.push({
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId(),
      text,
      checked: candidate.checked === true,
    })
  }

  return subtasks
}

/**
 * A task as it travels between devices. Category ids are local to one browser,
 * so the wire format carries the category *name* instead and the receiver
 * matches or creates its own.
 */
export interface SharedTodo extends Todo {
  categoryName: string | null
}

function normalizeEntry(entry: unknown): SharedTodo | null {
  if (!entry || typeof entry !== 'object') return null

  const candidate = entry as Partial<Todo> & { cat?: unknown }
  const text = typeof candidate.text === 'string' ? candidate.text.trim() : ''
  if (!text) return null

  const categoryName = typeof candidate.cat === 'string' ? cleanCategoryName(candidate.cat) : ''

  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId(),
    text,
    checked: candidate.checked === true,
    subtasks: normalizeSubtasks(candidate.subtasks),
    categoryId: typeof candidate.categoryId === 'string' && candidate.categoryId
      ? candidate.categoryId
      : null,
    categoryName: categoryName || null,
  }
}

/**
 * Coerce unknown input into valid todos, migrating the pre-id, pre-subtask and
 * pre-category formats (including anything shared over QR from an older build).
 */
export function normalizeTodos(input: unknown): Todo[] {
  return normalizeSharedTodos(input).map(({ categoryName: _categoryName, ...todo }) => todo)
}

/** Same coercion, but keeps the sender's category name for the import step. */
export function normalizeSharedTodos(input: unknown): SharedTodo[] {
  if (!Array.isArray(input)) return []

  const seen = new Set<string>()
  const todos: SharedTodo[] = []

  for (const entry of input) {
    const todo = normalizeEntry(entry)
    // Empty tasks are meaningless, and duplicate text breaks the "already
    // present" rule the UI relies on.
    if (!todo || seen.has(todo.text)) continue
    seen.add(todo.text)
    todos.push(todo)
  }

  return todos
}

/**
 * Drops category references that no longer resolve, which is what a
 * half-written storage state or a hand-edited localStorage entry looks like.
 */
export function reconcileCategories(todos: Todo[], categories: Category[]): Todo[] {
  const ids = new Set(categories.map((category) => category.id))
  return todos.map((todo) =>
    todo.categoryId && !ids.has(todo.categoryId) ? { ...todo, categoryId: null } : todo,
  )
}

/** `2/5` progress for a task's sub-list. */
export function subtaskProgress(todo: Todo): { done: number; total: number } {
  return {
    total: todo.subtasks.length,
    done: todo.subtasks.filter((subtask) => subtask.checked).length,
  }
}

export interface CategoryGroup {
  /** null is the "Uncategorised" bucket. */
  category: Category | null
  todos: Todo[]
}

/**
 * Buckets tasks for the grouped view. Every category gets a group even when it
 * is empty, so it stays visible as a drop target; the uncategorised bucket only
 * appears when something is actually in it.
 */
export function groupByCategory(todos: Todo[], categories: Category[]): CategoryGroup[] {
  const buckets = new Map<string, Todo[]>(categories.map((category) => [category.id, []]))
  const loose: Todo[] = []

  for (const todo of todos) {
    const bucket = todo.categoryId ? buckets.get(todo.categoryId) : undefined
    if (bucket) bucket.push(todo)
    else loose.push(todo)
  }

  const groups: CategoryGroup[] = categories.map((category) => ({
    category,
    todos: buckets.get(category.id) ?? [],
  }))

  if (loose.length > 0) groups.push({ category: null, todos: loose })

  return groups
}

/* Persistence ------------------------------------------------------------- */

export function loadCategories(): Category[] {
  try {
    const raw = window.localStorage.getItem(CATEGORY_STORAGE_KEY)
    return raw ? normalizeCategories(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveCategories(categories: Category[]): void {
  try {
    window.localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(categories))
  } catch {
    /* storage may be full or blocked - the UI keeps working in memory */
  }
}

export function loadTodos(): Todo[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeTodos(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveTodos(todos: Todo[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  } catch {
    /* storage may be full or blocked - the UI keeps working in memory */
  }
}
