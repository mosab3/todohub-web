import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { CheckIcon, CloseIcon, PlusIcon, SlidersIcon, TagIcon, TrashIcon } from './icons'
import {
  CATEGORY_COLORS,
  categoryColorVar,
  MAX_CATEGORIES,
  MAX_CATEGORY_NAME,
  type Category,
  type CategoryColor,
  type Todo,
} from './todos'
import { Button, IconButton, Menu, MenuItem, Modal } from './ui'
import { useDropZone } from '@/hooks/useDropZone'

/**
 * Filter value for the task list.
 *
 * `null` means every task, `''` means only uncategorised tasks, and anything
 * else is a category id. `createId()` never returns an empty string, so the
 * sentinel cannot collide with a real id.
 */
export type CategoryFilter = string | null

export const UNCATEGORIZED: CategoryFilter = ''

/* Chip rail --------------------------------------------------------------- */

interface ChipProps {
  label: string
  count: number
  active: boolean
  onSelect: () => void
  /** Palette colour, omitted for the "All" and "Uncategorised" chips. */
  color?: CategoryColor
  /** Assigns the dropped task to this chip's category. Omit to refuse drops. */
  onDropTask?: (taskId: string) => void
}

function Chip({ label, count, active, onSelect, color, onDropTask }: ChipProps) {
  const { over, handlers } = useDropZone(onDropTask ?? (() => {}))
  const dropHandlers = onDropTask ? handlers : {}

  return (
    <button
      type="button"
      className="chip"
      aria-pressed={active}
      data-drop={over}
      style={{ '--cat': color ? categoryColorVar(color) : 'var(--text-3)' } as CSSProperties}
      onClick={onSelect}
      {...dropHandlers}
    >
      {color ? <span className="chip__dot" aria-hidden="true" /> : null}
      <span className="chip__label">{label}</span>
      <span className="chip__count">{count}</span>
    </button>
  )
}

interface CategoryBarProps {
  categories: Category[]
  todos: Todo[]
  filter: CategoryFilter
  onFilterChange: (filter: CategoryFilter) => void
  /** Returns false when the name was rejected, so the field can stay open. */
  onCreate: (name: string) => boolean
  onAssign: (taskId: string, categoryId: string | null) => void
  onManage: () => void
}

/**
 * The category rail: a filter and a drop surface at once.
 *
 * Clicking a chip narrows the list; dragging a task row onto one moves that task
 * into the category. Keyboard and touch users get the same operation from the
 * tag menu on each row, because HTML drag-and-drop fires no events on touch.
 */
export function CategoryBar({
  categories,
  todos,
  filter,
  onFilterChange,
  onCreate,
  onAssign,
  onManage,
}: CategoryBarProps) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const looseCount = todos.filter((todo) => !todo.categoryId).length
  const full = categories.length >= MAX_CATEGORIES

  // A rejected name (empty, duplicate, over the limit) keeps the field open with
  // what was typed, so the toast can be acted on instead of retyped.
  const submit = () => {
    const name = draft.trim()
    if (name && !onCreate(name)) return
    setDraft('')
    setAdding(false)
  }

  const cancel = () => {
    setDraft('')
    setAdding(false)
  }

  return (
    <div className="catbar" role="group" aria-label="Filter by category">
      <Chip
        label="All"
        count={todos.length}
        active={filter === null}
        onSelect={() => onFilterChange(null)}
      />

      {categories.map((category) => (
        <Chip
          key={category.id}
          label={category.name}
          color={category.color}
          count={todos.filter((todo) => todo.categoryId === category.id).length}
          active={filter === category.id}
          onSelect={() => onFilterChange(category.id)}
          onDropTask={(taskId) => onAssign(taskId, category.id)}
        />
      ))}

      {looseCount > 0 || categories.length > 0 ? (
        <Chip
          label="Uncategorised"
          count={looseCount}
          active={filter === UNCATEGORIZED}
          onSelect={() => onFilterChange(UNCATEGORIZED)}
          onDropTask={(taskId) => onAssign(taskId, null)}
        />
      ) : null}

      {adding ? (
        <span className="catbar__form">
          <input
            ref={inputRef}
            className="catbar__input"
            value={draft}
            dir="auto"
            maxLength={MAX_CATEGORY_NAME}
            placeholder="Category name"
            aria-label="New category name"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
              if (event.key === 'Escape') cancel()
            }}
          />
          <IconButton className="icon-btn--sm" label="Create category" onClick={submit}>
            <CheckIcon size={15} />
          </IconButton>
          <IconButton className="icon-btn--sm" label="Cancel" onClick={cancel}>
            <CloseIcon size={15} />
          </IconButton>
        </span>
      ) : (
        <button
          type="button"
          className="chip chip--new"
          onClick={() => setAdding(true)}
          disabled={full}
          title={full ? `You can have up to ${MAX_CATEGORIES} categories.` : undefined}
        >
          <PlusIcon size={14} />
          <span className="chip__label">New category</span>
        </button>
      )}

      <span className="spacer" />

      {categories.length > 0 ? (
        <IconButton label="Manage categories" onClick={onManage}>
          <SlidersIcon size={18} />
        </IconButton>
      ) : null}
    </div>
  )
}

/* Per-task category picker ------------------------------------------------ */

interface CategoryPickerProps {
  todo: Todo
  categories: Category[]
  onAssign: (taskId: string, categoryId: string | null) => void
}

/**
 * The accessible counterpart to dragging: assigns a category from a menu.
 * This is the primary path on touch devices, where drag events never fire.
 */
export function CategoryPicker({ todo, categories, onAssign }: CategoryPickerProps) {
  const current = categories.find((category) => category.id === todo.categoryId)

  return (
    <Menu
      className="task__tag"
      label={
        current ? `Category of "${todo.text}": ${current.name}` : `Add "${todo.text}" to a category`
      }
      icon={<TagIcon size={18} />}
    >
      {(close) => (
        <>
          {categories.map((category) => (
            <MenuItem
              key={category.id}
              selected={category.id === todo.categoryId}
              swatch={categoryColorVar(category.color)}
              onClick={() => {
                onAssign(todo.id, category.id)
                close()
              }}
            >
              {category.name}
            </MenuItem>
          ))}
          <MenuItem
            selected={!todo.categoryId}
            onClick={() => {
              onAssign(todo.id, null)
              close()
            }}
          >
            No category
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

/* Manager modal ----------------------------------------------------------- */

interface CategoryRowProps {
  category: Category
  taskCount: number
  onRename: (id: string, name: string) => boolean
  onRecolor: (id: string, color: CategoryColor) => void
  onDelete: (id: string) => void
}

function CategoryRow({ category, taskCount, onRename, onRecolor, onDelete }: CategoryRowProps) {
  const [draft, setDraft] = useState(category.name)

  // An accepted rename changes category.name; a rejected one does not, so the
  // field has to be pulled back explicitly or it keeps showing a name that was
  // never applied.
  useEffect(() => {
    setDraft(category.name)
  }, [category.name])

  const commit = () => {
    if (draft.trim() === category.name) return
    if (!onRename(category.id, draft)) setDraft(category.name)
  }

  return (
    <div className="cat-row" style={{ '--cat': categoryColorVar(category.color) } as CSSProperties}>
      <div className="cat-row__head">
        <input
          className="cat-row__name"
          value={draft}
          dir="auto"
          maxLength={MAX_CATEGORY_NAME}
          aria-label={`Rename ${category.name}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') setDraft(category.name)
          }}
          onBlur={commit}
        />
        <span className="pill pill--sm">{taskCount}</span>
        <IconButton
          label={`Delete category ${category.name}`}
          danger
          onClick={() => onDelete(category.id)}
        >
          <TrashIcon size={17} />
        </IconButton>
      </div>

      <div className="swatches" role="radiogroup" aria-label={`Colour for ${category.name}`}>
        {CATEGORY_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={color === category.color}
            aria-label={color}
            className="swatch"
            style={{ '--swatch': categoryColorVar(color) } as CSSProperties}
            onClick={() => onRecolor(category.id, color)}
          />
        ))}
      </div>
    </div>
  )
}

interface CategoryManagerProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  todos: Todo[]
  onCreate: (name: string) => void
  onRename: (id: string, name: string) => boolean
  onRecolor: (id: string, color: CategoryColor) => void
  onDelete: (id: string) => void
}

export function CategoryManager({
  open,
  onClose,
  categories,
  todos,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
}: CategoryManagerProps) {
  const [draft, setDraft] = useState('')
  const full = categories.length >= MAX_CATEGORIES

  const submit = () => {
    const name = draft.trim()
    if (!name) return
    onCreate(name)
    setDraft('')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Categories"
      footer={
        <>
          <span className="modal__note">
            Deleting a category keeps its tasks - they move to Uncategorised.
          </span>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 'var(--sp-4)' }}>
        {categories.length === 0 ? (
          <p className="modal__note">No categories yet. Add one below.</p>
        ) : (
          categories.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              taskCount={todos.filter((todo) => todo.categoryId === category.id).length}
              onRename={onRename}
              onRecolor={onRecolor}
              onDelete={onDelete}
            />
          ))
        )}

        <div className="cat-add">
          <input
            className="cat-add__input"
            value={draft}
            dir="auto"
            maxLength={MAX_CATEGORY_NAME}
            disabled={full}
            placeholder={full ? `Limit of ${MAX_CATEGORIES} reached` : 'Add a category'}
            aria-label="New category name"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
          <Button onClick={submit} disabled={full || !draft.trim()}>
            <PlusIcon size={16} />
            Add
          </Button>
        </div>
      </div>
    </Modal>
  )
}
