import { useRef, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import { CategoryPicker } from './categories'
import { CheckIcon, CloseIcon, GripIcon, PencilIcon, PlusIcon, TrashIcon } from './icons'
import { IconButton } from './ui'
import { categoryColorVar, subtaskProgress, type Category, type Todo } from './todos'
import { TASK_DND_TYPE, useDropZone, type DropHandlers } from '@/hooks/useDropZone'

/** Everything the sub-list editor needs, grouped so task rows stay readable. */
export interface SubtaskControls {
  /** Id of the task whose "add step" composer is open, if any. */
  composerFor: string | null
  draft: string
  onOpenComposer: (todoId: string) => void
  onCloseComposer: () => void
  onDraftChange: (value: string) => void
  onAdd: (todoId: string) => void
  onToggle: (todoId: string, subtaskId: string) => void
  onDelete: (todoId: string, subtaskId: string) => void
}

interface TaskItemProps {
  todo: Todo
  /** Position in its section - drives the staggered entrance animation. */
  index: number
  editing: boolean
  draft: string
  removing: boolean
  onDraftChange: (value: string) => void
  onToggle: (id: string) => void
  onStartEdit: (todo: Todo) => void
  onCommitEdit: (id: string) => void
  onCancelEdit: () => void
  onDelete: (id: string) => void
  subtasks: SubtaskControls
  categories: Category[]
  onAssignCategory: (todoId: string, categoryId: string | null) => void
  /** True while this row is the drag source, so the original can dim. */
  dragging: boolean
  onDragStateChange: (todoId: string | null) => void
  /**
   * Shows the category as a chip on the row. Off in the grouped view, where the
   * section heading already names it.
   */
  showCategory: boolean
}

export function TaskItem({
  todo,
  index,
  editing,
  draft,
  removing,
  onDraftChange,
  onToggle,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onDelete,
  subtasks,
  categories,
  onAssignCategory,
  dragging,
  onDragStateChange,
  showCategory,
}: TaskItemProps) {
  // Escape cancels the edit; without this the resulting blur would re-commit it.
  const skipBlurCommit = useRef(false)
  // Same guard for the "add step" field.
  const skipComposerBlur = useRef(false)
  const rowRef = useRef<HTMLLIElement>(null)

  const composerOpen = subtasks.composerFor === todo.id
  const progress = subtaskProgress(todo)
  const hasSubtasks = progress.total > 0
  const category = categories.find((entry) => entry.id === todo.categoryId)
  // Nowhere to drag a task to until a category exists.
  const canDrag = categories.length > 0 && !editing

  const commitSubtask = () => {
    if (skipComposerBlur.current) return
    if (subtasks.draft.trim()) subtasks.onAdd(todo.id)
    else subtasks.onCloseComposer()
  }

  const handleDragStart = (event: DragEvent) => {
    event.dataTransfer.setData(TASK_DND_TYPE, todo.id)
    event.dataTransfer.effectAllowed = 'move'
    // Drag the whole row, not the little handle the pointer grabbed.
    if (rowRef.current) event.dataTransfer.setDragImage(rowRef.current, 24, 20)
    onDragStateChange(todo.id)
  }

  return (
    <li
      ref={rowRef}
      className="task"
      data-done={todo.checked}
      data-editing={editing}
      data-removing={removing}
      data-dragging={dragging}
      style={{ '--i': index } as CSSProperties}
    >
      {canDrag ? (
        <span
          className="task__grip"
          draggable
          title="Drag onto a category"
          aria-hidden="true"
          onDragStart={handleDragStart}
          onDragEnd={() => onDragStateChange(null)}
        >
          <GripIcon size={16} />
        </span>
      ) : null}

      <label className="check">
        <input
          type="checkbox"
          checked={todo.checked}
          disabled={editing}
          onChange={() => onToggle(todo.id)}
          aria-label={`Mark "${todo.text}" as ${todo.checked ? 'not done' : 'done'}`}
        />
        <span className="check__box">
          <CheckIcon size={14} />
        </span>
      </label>

      <div className="task__body">
        <div className="task__row">
          {editing ? (
            <input
              className="task__input"
              value={draft}
              dir="auto"
              autoFocus
              aria-label="Edit task"
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onCommitEdit(todo.id)
                if (event.key === 'Escape') {
                  skipBlurCommit.current = true
                  onCancelEdit()
                }
              }}
              onBlur={() => {
                if (skipBlurCommit.current) {
                  skipBlurCommit.current = false
                  return
                }
                onCommitEdit(todo.id)
              }}
            />
          ) : (
            <span
              className="task__text"
              dir="auto"
              onDoubleClick={() => {
                if (!todo.checked) onStartEdit(todo)
              }}
            >
              <span className="task__label">{todo.text}</span>
            </span>
          )}

          {showCategory && category ? (
            <span
              className="task__cat"
              style={{ '--cat': categoryColorVar(category.color) } as CSSProperties}
            >
              <span className="chip__dot" aria-hidden="true" />
              {category.name}
            </span>
          ) : null}

          {hasSubtasks ? (
            <span
              className="pill pill--sm"
              title={`${progress.done} of ${progress.total} steps done`}
              data-complete={progress.done === progress.total}
            >
              {progress.done}/{progress.total}
            </span>
          ) : null}
        </div>

        {hasSubtasks ? (
          <ul className="subtasks" aria-label={`Steps for ${todo.text}`}>
            {todo.subtasks.map((subtask, subtaskIndex) => (
              <li
                className="subtask"
                key={subtask.id}
                data-done={subtask.checked}
                style={{ '--i': subtaskIndex } as CSSProperties}
              >
                <label className="check check--sm">
                  <input
                    type="checkbox"
                    checked={subtask.checked}
                    onChange={() => subtasks.onToggle(todo.id, subtask.id)}
                    aria-label={`Mark step "${subtask.text}" as ${subtask.checked ? 'not done' : 'done'}`}
                  />
                  <span className="check__box">
                    <CheckIcon size={11} />
                  </span>
                </label>
                <span className="subtask__text" dir="auto">
                  <span className="subtask__label">{subtask.text}</span>
                </span>
                <div className="subtask__actions">
                  <IconButton
                    className="icon-btn--sm"
                    label={`Delete step "${subtask.text}"`}
                    danger
                    onClick={() => subtasks.onDelete(todo.id, subtask.id)}
                  >
                    <TrashIcon size={15} />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {composerOpen ? (
          <div className="subtask-composer">
            <input
              value={subtasks.draft}
              dir="auto"
              autoFocus
              placeholder="Add a step and press Enter"
              aria-label={`Add a step to ${todo.text}`}
              onChange={(event) => subtasks.onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') subtasks.onAdd(todo.id)
                if (event.key === 'Escape') {
                  skipComposerBlur.current = true
                  subtasks.onCloseComposer()
                }
              }}
              onBlur={() => {
                if (skipComposerBlur.current) {
                  skipComposerBlur.current = false
                  return
                }
                commitSubtask()
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="task__actions">
        {editing ? (
          <>
            <IconButton label="Save changes" onClick={() => onCommitEdit(todo.id)}>
              <CheckIcon size={18} />
            </IconButton>
            <IconButton label="Cancel editing" onClick={onCancelEdit}>
              <CloseIcon size={18} />
            </IconButton>
          </>
        ) : (
          <>
            {todo.checked ? null : (
              <>
                {categories.length > 0 ? (
                  <CategoryPicker
                    todo={todo}
                    categories={categories}
                    onAssign={onAssignCategory}
                  />
                ) : null}
                <IconButton
                  label={`Add a step to "${todo.text}"`}
                  onClick={() => subtasks.onOpenComposer(todo.id)}
                >
                  <PlusIcon size={18} />
                </IconButton>
                <IconButton label={`Edit "${todo.text}"`} onClick={() => onStartEdit(todo)}>
                  <PencilIcon size={18} />
                </IconButton>
              </>
            )}
            <IconButton label={`Delete "${todo.text}"`} danger onClick={() => onDelete(todo.id)}>
              <TrashIcon size={18} />
            </IconButton>
          </>
        )}
      </div>
    </li>
  )
}

interface TaskSectionProps {
  title: string
  count: number
  children: ReactNode
  /** Palette colour of the category this section represents, if any. */
  accent?: string
  /** True while a dragged task hovers this section. */
  dropActive?: boolean
  dropHandlers?: Partial<DropHandlers>
}

export function TaskSection({
  title,
  count,
  children,
  accent,
  dropActive = false,
  dropHandlers,
}: TaskSectionProps) {
  return (
    <section
      className="section"
      aria-label={title}
      data-drop={dropActive}
      style={accent ? ({ '--cat': accent } as CSSProperties) : undefined}
      {...dropHandlers}
    >
      <div className="section__head">
        {accent ? <span className="section__dot" aria-hidden="true" /> : null}
        <h2 className="section__title">{title}</h2>
        <span className="pill">{count}</span>
        <span className="section__rule" />
      </div>
      {children}
    </section>
  )
}

interface CategorySectionProps {
  title: string
  count: number
  accent?: string
  onDropTask: (taskId: string) => void
  children: ReactNode
}

/**
 * A `TaskSection` wired as a drop target. Split out because `useDropZone` is a
 * hook and every group on screen needs its own hover state.
 */
export function CategorySection({
  title,
  count,
  accent,
  onDropTask,
  children,
}: CategorySectionProps) {
  const { over, handlers } = useDropZone(onDropTask)

  return (
    <TaskSection
      title={title}
      count={count}
      accent={accent}
      dropActive={over}
      dropHandlers={handlers}
    >
      {children}
    </TaskSection>
  )
}
