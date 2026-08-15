/**
 * 轻量、零依赖、安全的 release notes 渲染器。
 *
 * 支持的子集：
 * - 三级及以下标题（`#`/`##`/`###`）
 * - 无序列表（`-`）
 * - 行内代码（`...`）
 * - 链接（`[text](url)`，仅 http/https/mailto 白名单）
 * - 加粗（`**...**`）
 * - 其余字符走 HTML escape
 *
 * 严格不做：
 * - 不解析 `<script>`/`<style>`/`<iframe>` 等任意 HTML
 * - 不解析图片、HTML 块、表格、引用块
 * - 不解释 HTML 属性（onerror/onload 等）
 * - 不允许 data:、javascript:、file: 等危险协议
 *
 * 渲染产物为 React 元素数组，调用方负责根容器。
 */

import { Fragment, type ReactNode } from "react";

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function escapeText(input: string): string {
  // React 在把字符串作为 JSX 文本子节点渲染时，会自动对 `&`/`<`/`>`/`"'` 进行转义。
  // 这里额外保留一个接口是为了万一未来要拼接 HTML 字符串或属性值时仍能调用；
  // 当前调用点全部走 JSX 子节点，所以直接返回原文即可，避免出现 `&amp;amp;`
  // 这种双重转义问题。
  return input;
}

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("#")) return true; // 同页锚点
  // 协议相对 URL（//example.com）
  if (trimmed.startsWith("//")) return true;
  try {
    const parsed = new URL(trimmed, "https://example.invalid/");
    return SAFE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * 把单个段落（已经按空行切分过）解析成 React 节点。
 * 支持 inline: `code`, **bold**, [text](url), 普通文本。
 */
function renderInline(line: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // 一个 token 一次切：用正则贪婪最小匹配，遇到 markdown 标记或撞到末尾
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^\s)]+\))|([^`*[]+)/g;
  let match: RegExpExecArray | null;
  let counter = 0;
  while ((match = re.exec(line)) !== null) {
    const token = match[0];
    const nodeKey = `${keyPrefix}-${counter++}`;
    if (token.startsWith("`")) {
      const inner = token.slice(1, -1);
      nodes.push(
        <code key={nodeKey} className="release-notes-inline-code">
          {escapeText(inner)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      const inner = token.slice(2, -2);
      nodes.push(<strong key={nodeKey}>{escapeText(inner)}</strong>);
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(token);
      if (linkMatch && isSafeUrl(linkMatch[2])) {
        const text = linkMatch[1];
        const url = linkMatch[2];
        nodes.push(
          <a
            key={nodeKey}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="release-notes-link"
          >
            {escapeText(text)}
          </a>,
        );
      } else if (linkMatch) {
        // 不安全链接只保留可见文本，丢弃 URL（避免 javascript:/data: 协议刷入 DOM）
        nodes.push(
          <Fragment key={nodeKey}>{escapeText(linkMatch[1])}</Fragment>,
        );
      } else {
        nodes.push(<Fragment key={nodeKey}>{escapeText(token)}</Fragment>);
      }
    } else {
      nodes.push(<Fragment key={nodeKey}>{escapeText(token)}</Fragment>);
    }
  }
  if (nodes.length === 0) {
    nodes.push(
      <Fragment key={`${keyPrefix}-empty`}>{escapeText(line)}</Fragment>,
    );
  }
  return nodes;
}

function renderBlock(block: string, blockIndex: number): ReactNode {
  const lines = block.split("\n");
  const first = lines[0];
  const headingMatch = /^(#{1,3})\s+(.*)$/.exec(first);
  if (headingMatch && lines.length === 1) {
    const level = headingMatch[1].length;
    const content = headingMatch[2];
    const key = `block-${blockIndex}`;
    if (level === 1)
      return (
        <h2 key={key} className="release-notes-h1">
          {renderInline(content, key)}
        </h2>
      );
    if (level === 2)
      return (
        <h3 key={key} className="release-notes-h2">
          {renderInline(content, key)}
        </h3>
      );
    return (
      <h4 key={key} className="release-notes-h3">
        {renderInline(content, key)}
      </h4>
    );
  }

  // 列表检测：所有行都以 `- ` 开头
  const isList = lines.every((line) => /^\s*-\s+/.test(line));
  if (isList) {
    const items = lines.map((line, idx) => {
      const content = line.replace(/^\s*-\s+/, "");
      const key = `block-${blockIndex}-item-${idx}`;
      return (
        <li key={key} className="release-notes-li">
          {renderInline(content, key)}
        </li>
      );
    });
    return (
      <ul key={`block-${blockIndex}`} className="release-notes-ul">
        {items}
      </ul>
    );
  }

  // 段落：保留换行（多行内容按 <br> 拼）
  const key = `block-${blockIndex}`;
  if (lines.length === 1) {
    return (
      <p key={key} className="release-notes-p">
        {renderInline(first, key)}
      </p>
    );
  }
  return (
    <p key={key} className="release-notes-p">
      {lines.map((line, idx) => (
        <Fragment key={`${key}-line-${idx}`}>
          {idx > 0 ? <br /> : null}
          {renderInline(line, `${key}-line-${idx}`)}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * 把 release notes 字符串解析成 React 节点数组。
 * - 以空行分块
 * - 任何 HTML 标签先按纯文本转义再处理
 * - 不被识别的 markdown 结构也保持为段落
 */
export function renderReleaseNotes(input: string | undefined): ReactNode[] {
  if (!input) return [];
  // 先去掉所有 HTML 标签，避免误解析（如 `<script>` 注入会被 escape 而非执行）
  const sanitized = input.replace(/<[^>]*>/g, "");
  if (!sanitized.trim()) return [];
  const blocks = sanitized.split(/\n\s*\n/);
  return blocks.map((block, idx) => renderBlock(block, idx));
}
