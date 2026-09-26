import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  CategoryBar,
  CategoryManager,
  UNCATEGORIZED,
  type CategoryFilter,
} from '@/components/categories'
import { PlusIcon, ShareIcon } from '@/components/icons'
import { CategorySection, TaskItem, TaskSection, type SubtaskControls } from '@/components/list'
import { ShareModal } from '@/components/share'
import {
  cleanCategoryName,
  createId,
  findCategoryByName,
  groupByCategory,
  loadCategories,
  loadTodos,
  MAX_CATEGORIES,
  nextCategoryColor,
  reconcileCategories,
  saveCategories,
  saveTodos,
  categoryColorVar,
  type Category,
  type CategoryColor,
  type SharedTodo,
  type Todo,
} from '@/components/todos'
import { AppToaster, Button, EmptyState, Progress } from '@/components/ui'

/** Duration of the row exit animation in globals.css (`task-out`). */
const REMOVE_MS = 220

/**
 * Tasks and categories live under separate storage keys, so a task can outlive
 * the category it pointed at. Both are read together once and reconciled here
 * rather than guarding every later read.
 */
function bootstrap(): { categories: Category[]; todos: Todo[] } {
  const categories = loadCategories()
  return { categories, todos: reconcileCategories(loadTodos(), categories) }
}

export default function Home() {
  const [boot] = useState(bootstrap)
  const [categories, setCategories] = useState<Category[]>(boot.categories)
  const [todos, setTodos] = useState<Todo[]>(boot.todos)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [composerFor, setComposerFor] = useState<string | null>(null)
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const [filter, setFilter] = useState<CategoryFilter>(null)
  /** Id of the row currently being dragged, so the source can dim. */
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Tasks mid-exit-animation: still rendered, already logically deleted.
  const [removing, setRemoving] = useState<string[]>([])

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    saveTodos(todos)
  }, [todos])

  useEffect(() => {
    saveCategories(categories)
  }, [categories])

  const visible = useMemo(() => {
    if (filter === null) return todos
    if (filter === UNCATEGORIZED) return todos.filter((todo) => !todo.categoryId)
    return todos.filter((todo) => todo.categoryId === filter)
  }, [todos, filter])

  const active = useMemo(() => visible.filter((todo) => !todo.checked), [visible])
  const completed = useMemo(() => visible.filter((todo) => todo.checked), [visible])

  const selectedCategory = categories.find((category) => category.id === filter)
  let scope: string | undefined
  if (selectedCategory) scope = selectedCategory.name
  else if (filter === UNCATEGORIZED) scope = 'Uncategorised'

  /* Categories ------------------------------------------------------------- */

  // Returns false when the name was rejected, so the composer can keep the text
  // it already has instead of making the user retype it.
  const createCategory = (rawName: string): boolean => {
    const name = cleanCategoryName(rawName)
    if (!name) {
      toast.error('Give the category a name.')
      return false
    }
    if (categories.length >= MAX_CATEGORIES) {
      toast.error(`You can have up to ${MAX_CATEGORIES} categories.`)
      return false
    }
    if (findCategoryByName(categories, name)) {
      toast.error(`"${name}" already exists.`)
      return false
    }
    setCategories((prev) => [...prev, { id: createId(), name, color: nextCategoryColor(prev) }])
    toast.success(`Added "${name}".`)
    return true
  }

  // Returns false when the name was rejected, so the row can put the real name
  // back in the field instead of leaving a name that was never applied.
  const renameCategory = (id: string, rawName: string): boolean => {
    const name = cleanCategoryName(rawName)
    if (!name) {
      toast.error('A category cannot be empty.')
      return false
    }
    const clash = findCategoryByName(categories, name)
    if (clash && clash.id !== id) {
      toast.error(`"${name}" already exists.`)
      return false
    }
    setCategories((prev) =>
      prev.map((category) => (category.id === id ? { ...category, name } : category)),
    )
    return true
  }

  const recolorCategory = (id: string, color: CategoryColor) => {
    setCategories((prev) =>
      prev.map((category) => (category.id === id ? { ...category, color } : category)),
    )
  }

  /** Deletes the category only - its tasks fall back to Uncategorised. */
  const deleteCategory = (id: string) => {
    const category = categories.find((entry) => entry.id === id)
    if (!category) return

    const orphaned = todos.filter((todo) => todo.categoryId === id).length

    setCategories((prev) => prev.filter((entry) => entry.id !== id))
    setTodos((prev) =>
      prev.map((todo) => (todo.categoryId === id ? { ...todo, categoryId: null } : todo)),
    )
    if (filter === id) setFilter(null)

    toast.success(
      orphaned > 0
        ? `Deleted "${category.name}". ${orphaned} ${orphaned === 1 ? 'task' : 'tasks'} moved to Uncategorised.`
        : `Deleted "${category.name}".`,
    )
  }

  const assignCategory = (todoId: string, categoryId: string | null) => {
    const todo = todos.find((entry) => entry.id === todoId)
    if (!todo || todo.categoryId === categoryId) return

    setTodos((prev) =>
      prev.map((entry) => (entry.id === todoId ? { ...entry, categoryId } : entry)),
    )

    const target = categories.find((category) => category.id === categoryId)
    toast.success(
      target ? `Moved to "${target.name}".` : 'Moved to Uncategorised.',
    )
  }

  /* Tasks ------------------------------------------------------------------ */

  const addTodo = () => {
    const text = draft.trim()
    if (!text) {
      toast.error('Type a task first.')
      return
    }
    if (todos.some((todo) => todo.text === text)) {
      toast.error('That task is already on your list.')
      return
    }
    // A new task lands in whatever category is being viewed, which is almost
    // always where the user meant to put it.
    const categoryId = filter === null || filter === UNCATEGORIZED ? null : filter
    setTodos((prev) => [{ id: createId(), text, checked: false, subtasks: [], categoryId }, ...prev])
    setDraft('')
    inputRef.current?.focus()
  }

  /**
   * A task and its steps move together: completing the task completes every
   * step, and reopening it reopens them. Steps are otherwise independent, so
   * ticking one off never completes the task for you.
   */
  const toggleTodo = (id: string) => {
    setTodos((prev) =>
      prev.map((todo) => {
        if (todo.id !== id) return todo
        const checked = !todo.checked
        return {
          ...todo,
          checked,
          subtasks: todo.subtasks.map((subtask) => ({ ...subtask, checked })),
        }
      }),
    )
  }

  const startEdit = (todo: Todo) => {
    if (editingId && editingId !== todo.id) {
      toast.error('Finish the task you are editing first.')
      return
    }
    setEditingId(todo.id)
    setEditDraft(todo.text)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft('')
  }

  const commitEdit = (id: string) => {
    const text = editDraft.trim()
    if (!text) {
      toast.error('A task cannot be empty.')
      return
    }
    if (todos.some((todo) => todo.text === text && todo.id !== id)) {
      toast.error('That task already exists.')
      return
    }
    setTodos((prev) => prev.map((todo) => (todo.id === id ? { ...todo, text } : todo)))
    cancelEdit()
  }

  /** Removes after the exit animation so the row does not vanish abruptly. */
  const removeTodo = (id: string) => {
    if (removing.includes(id)) return
    setRemoving((prev) => [...prev, id])
    window.setTimeout(() => {
      setTodos((prev) => prev.filter((todo) => todo.id !== id))
      setRemoving((prev) => prev.filter((value) => value !== id))
      if (editingId === id) cancelEdit()
      if (composerFor === id) closeComposer()
    }, REMOVE_MS)
  }

  const clearCompleted = () => {
    const ids = completed.map((todo) => todo.id)
    if (ids.length === 0) return
    setRemoving((prev) => [...prev, ...ids])
    window.setTimeout(() => {
      setTodos((prev) => prev.filter((todo) => !ids.includes(todo.id)))
      setRemoving((prev) => prev.filter((id) => !ids.includes(id)))
      if (editingId && ids.includes(editingId)) cancelEdit()
      if (composerFor && ids.includes(composerFor)) closeComposer()
    }, REMOVE_MS)
    toast.success(`Cleared ${ids.length} completed ${ids.length === 1 ? 'task' : 'tasks'}.`)
  }

  /* Sub-list --------------------------------------------------------------- */

  const openComposer = (todoId: string) => {
    setComposerFor((current) => (current === todoId ? null : todoId))
    setSubtaskDraft('')
  }

  const closeComposer = () => {
    setComposerFor(null)
    setSubtaskDraft('')
  }

  const addSubtask = (todoId: string) => {
    const text = subtaskDraft.trim()
    if (!text) return

    const target = todos.find((todo) => todo.id === todoId)
    if (!target) return
    if (target.subtasks.some((subtask) => subtask.text === text)) {
      toast.error('That step is already on this task.')
      return
    }

    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === todoId
          ? { ...todo, subtasks: [...todo.subtasks, { id: createId(), text, checked: false }] }
          : todo,
      ),
    )
    // Composer stays open so several steps can be typed in a row.
    setSubtaskDraft('')
  }

  const toggleSubtask = (todoId: string, subtaskId: string) => {
    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === todoId
          ? {
              ...todo,
              subtasks: todo.subtasks.map((subtask) =>
                subtask.id === subtaskId ? { ...subtask, checked: !subtask.checked } : subtask,
              ),
            }
          : todo,
      ),
    )
  }

  const deleteSubtask = (todoId: string, subtaskId: string) => {
    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === todoId
          ? { ...todo, subtasks: todo.subtasks.filter((subtask) => subtask.id !== subtaskId) }
          : todo,
      ),
    )
  }

  const subtaskControls: SubtaskControls = {
    composerFor,
    draft: subtaskDraft,
    onOpenComposer: openComposer,
    onCloseComposer: closeComposer,
    onDraftChange: setSubtaskDraft,
    onAdd: addSubtask,
    onToggle: toggleSubtask,
    onDelete: deleteSubtask,
  }

  /**
   * Imported tasks carry a category *name*. Match it against the local
   * categories case-insensitively and create what is missing, so a shared list
   * arrives organised instead of flattened.
   */
  const importTodos = (incoming: SharedTodo[]) => {
    const nextCategories = [...categories]
    let created = 0

    const prepared: Todo[] = incoming.map(({ categoryName, ...todo }) => {
      if (!categoryName) return { ...todo, categoryId: null }

      let category = findCategoryByName(nextCategories, categoryName)
      if (!category && nextCategories.length < MAX_CATEGORIES) {
        category = { id: createId(), name: categoryName, color: nextCategoryColor(nextCategories) }
        nextCategories.push(category)
        created += 1
      }
      return { ...todo, categoryId: category?.id ?? null }
    })

    if (created > 0) setCategories(nextCategories)
    setTodos((prev) => [...prev, ...prepared])

    const taskNote = `Added ${incoming.length} ${incoming.length === 1 ? 'task' : 'tasks'}`
    toast.success(
      created > 0
        ? `${taskNote} and ${created} new ${created === 1 ? 'category' : 'categories'}.`
        : `${taskNote}.`,
    )
  }

  /* Render ----------------------------------------------------------------- */

  // Grouped only in the unfiltered view: once a single category is selected the
  // heading would just repeat the chip above it.
  const grouped = filter === null && categories.length > 0
  const activeGroups = useMemo(
    () => (grouped ? groupByCategory(active, categories) : []),
    [grouped, active, categories],
  )

  const renderTask = (todo: Todo, index: number, editable = true) => (
    <TaskItem
      key={todo.id}
      todo={todo}
      index={index}
      editing={editable && editingId === todo.id}
      draft={editable ? editDraft : ''}
      removing={removing.includes(todo.id)}
      onDraftChange={setEditDraft}
      onToggle={toggleTodo}
      onStartEdit={startEdit}
      onCommitEdit={commitEdit}
      onCancelEdit={cancelEdit}
      onDelete={removeTodo}
      subtasks={subtaskControls}
      categories={categories}
      onAssignCategory={assignCategory}
      dragging={draggingId === todo.id}
      onDragStateChange={setDraggingId}
      showCategory={!grouped}
    />
  )

  return (
    <>
      <AppToaster />

      <section className="hero">
        <span className="hero__eyebrow">
          <span className="hero__dot" />
          Local-first &middot; no account needed
        </span>
        <h1 className="hero__title">
          Get it out of your head, <em>onto the list</em>.
        </h1>
        <p className="hero__lede">
          A todo list that lives entirely in this browser. Big tasks can hold their own steps, and
          categories keep work, errands and side projects from blurring into one pile.
        </p>
      </section>

      <Progress done={completed.length} total={visible.length} scope={scope} />

      <div className="composer">
        <Button className="btn--round" onClick={addTodo} aria-label="Add task">
          <PlusIcon size={20} />
        </Button>
        <input
          ref={inputRef}
          className="composer__input"
          value={draft}
          dir="auto"
          autoFocus
          placeholder={selectedCategory ? `Add to ${selectedCategory.name}…` : 'What needs doing?'}
          aria-label="New task"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addTodo()
          }}
        />
        <Button variant="ghost" onClick={() => setShareOpen(true)}>
          <ShareIcon size={18} />
          <span className="composer__label">Share</span>
        </Button>
      </div>

      <CategoryBar
        categories={categories}
        todos={todos}
        filter={filter}
        onFilterChange={setFilter}
        onCreate={createCategory}
        onAssign={assignCategory}
        onManage={() => setManagerOpen(true)}
      />

      {todos.length === 0 ? (
        <EmptyState
          title="Nothing on the list"
          body="Add your first task above. Open a task's + button to break it into steps, group tasks with categories, and everything stays in this browser."
        />
      ) : (
        <>
          {grouped ? (
            activeGroups.map((group) => (
              <CategorySection
                key={group.category?.id ?? 'uncategorised'}
                title={group.category?.name ?? 'Uncategorised'}
                count={group.todos.length}
                accent={
                  group.category ? categoryColorVar(group.category.color) : 'var(--text-3)'
                }
                onDropTask={(taskId) => assignCategory(taskId, group.category?.id ?? null)}
              >
                {group.todos.length === 0 ? (
                  <p className="section__empty">
                    Nothing here yet. Drag a task in, or pick this category from a task&apos;s tag
                    menu.
                  </p>
                ) : (
                  <ul className="tasks">{group.todos.map((todo, index) => renderTask(todo, index))}</ul>
                )}
              </CategorySection>
            ))
          ) : (
            <TaskSection title="Active" count={active.length}>
              {active.length === 0 ? (
                <p className="section__empty">All clear. Nothing left to do.</p>
              ) : (
                <ul className="tasks">{active.map((todo, index) => renderTask(todo, index))}</ul>
              )}
            </TaskSection>
          )}

          {completed.length > 0 ? (
            <TaskSection title="Completed" count={completed.length}>
              <ul className="tasks">
                {completed.map((todo, index) => renderTask(todo, index, false))}
              </ul>
              <div className="section__actions">
                <Button variant="quiet" onClick={clearCompleted}>
                  Clear completed
                </Button>
              </div>
            </TaskSection>
          ) : null}
        </>
      )}

      <CategoryManager
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        categories={categories}
        todos={todos}
        onCreate={createCategory}
        onRename={renameCategory}
        onRecolor={recolorCategory}
        onDelete={deleteCategory}
      />

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        todos={todos}
        categories={categories}
        onImport={importTodos}
      />
    </>
  )
}
