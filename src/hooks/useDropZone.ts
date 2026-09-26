import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'

/**
 * Custom MIME type carrying the dragged task's id.
 *
 * Lowercase on purpose: the HTML drag-and-drop spec lowercases custom types, so
 * a mixed-case string would not match what `dataTransfer.types` reports.
 */
export const TASK_DND_TYPE = 'application/x-todohub-task'

export interface DropHandlers {
  onDragEnter: (event: DragEvent) => void
  onDragLeave: (event: DragEvent) => void
  onDragOver: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
}

function carriesTask(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(TASK_DND_TYPE)
}

/**
 * Turns an element into a drop target for task rows.
 *
 * `dragenter`/`dragleave` fire for every descendant the pointer crosses, so the
 * hover state is reference-counted rather than a plain boolean - otherwise it
 * flickers off the moment the cursor moves over a child. A window-level
 * `dragend` clears the count when a drag is abandoned outside the target, which
 * never produces a `dragleave`.
 */
export function useDropZone(onDropTask: (taskId: string) => void): {
  over: boolean
  handlers: DropHandlers
} {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const reset = useCallback(() => {
    depth.current = 0
    setOver(false)
  }, [])

  useEffect(() => {
    window.addEventListener('dragend', reset)
    window.addEventListener('drop', reset)
    return () => {
      window.removeEventListener('dragend', reset)
      window.removeEventListener('drop', reset)
    }
  }, [reset])

  const onDragEnter = useCallback((event: DragEvent) => {
    if (!carriesTask(event)) return
    event.preventDefault()
    depth.current += 1
    setOver(true)
  }, [])

  const onDragLeave = useCallback((event: DragEvent) => {
    if (!carriesTask(event)) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setOver(false)
  }, [])

  const onDragOver = useCallback((event: DragEvent) => {
    if (!carriesTask(event)) return
    // Without this the browser refuses the drop and shows a "no entry" cursor.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!carriesTask(event)) return
      event.preventDefault()
      const taskId = event.dataTransfer.getData(TASK_DND_TYPE)
      reset()
      if (taskId) onDropTask(taskId)
    },
    [onDropTask, reset],
  )

  return { over, handlers: { onDragEnter, onDragLeave, onDragOver, onDrop } }
}
