import { WorkflowMarkdownContent } from './MarkdownContent'

interface Props {
  text: string
  hasLeadingContent: boolean
}

export function WorkflowAssistantAnswer({ text, hasLeadingContent }: Props) {
  return (
    <article
      className={`${hasLeadingContent ? 'mt-3.5' : 'pt-0.5'} max-w-full text-[14px] leading-[1.72] text-text-strong`}
      data-kind="assistant-answer"
    >
      <WorkflowMarkdownContent content={text} />
    </article>
  )
}
