import { useCallback, useEffect, useRef, useState } from 'react'

export type WorkflowScrollAnchorOptions = {
  contentSignal: unknown
  isGenerating: boolean
  isReplayView: boolean
  replayLocationKey: string
  sessionKey: string
  nearBottomThreshold?: number
}

export type WorkflowScrollAnchor = {
  viewportRef: React.RefObject<HTMLDivElement>
  handleScroll: () => void
  isAtBottom: boolean
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

export function workflowScrollIsNearBottom({
  scrollHeight,
  scrollTop,
  clientHeight,
  threshold = 80,
}: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
  threshold?: number
}) {
  return scrollHeight - scrollTop - clientHeight < threshold
}

export function useWorkflowScrollAnchor({
  contentSignal,
  isGenerating,
  isReplayView,
  replayLocationKey,
  sessionKey,
  nearBottomThreshold = 80,
}: WorkflowScrollAnchorOptions): WorkflowScrollAnchor {
  const viewportRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottomRef = useRef(true)
  const lastSessionKeyRef = useRef<string | null>(null)
  const lastReplayLocationRef = useRef('')
  const [isAtBottom, setIsAtBottom] = useState(true)

  const setBottomStickiness = useCallback((next: boolean) => {
    shouldStickToBottomRef.current = next
    setIsAtBottom(current => current === next ? current : next)
  }, [])

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    setBottomStickiness(workflowScrollIsNearBottom({
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
      clientHeight: viewport.clientHeight,
      threshold: nearBottomThreshold,
    }))
  }, [nearBottomThreshold, setBottomStickiness])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior })
    setBottomStickiness(true)
  }, [setBottomStickiness])

  const scheduleScrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    requestAnimationFrame(() => {
      scrollToBottom(behavior)
      requestAnimationFrame(() => {
        scrollToBottom('auto')
      })
    })
  }, [scrollToBottom])

  useEffect(() => {
    if (lastSessionKeyRef.current !== sessionKey) {
      lastSessionKeyRef.current = sessionKey
      setBottomStickiness(true)
    }

    if (isReplayView) {
      if (lastReplayLocationRef.current !== replayLocationKey) {
        lastReplayLocationRef.current = replayLocationKey
        setBottomStickiness(true)
        scheduleScrollToBottom('auto')
        return
      }

      if (shouldStickToBottomRef.current) {
        scheduleScrollToBottom('auto')
      }
      return
    }

    lastReplayLocationRef.current = ''

    if (shouldStickToBottomRef.current) {
      scheduleScrollToBottom('smooth')
    }
  }, [contentSignal, isGenerating, isReplayView, replayLocationKey, scheduleScrollToBottom, sessionKey, setBottomStickiness])

  return {
    viewportRef,
    handleScroll,
    isAtBottom,
    scrollToBottom,
  }
}
