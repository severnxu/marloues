import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { TreeNode } from "./skill-normalizers";

function collectFolderPaths(nodes: TreeNode[], parentPath = ""): string[] {
  return nodes.flatMap((node) => {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.type !== "folder") return [];
    return [path, ...collectFolderPaths(node.children ?? [], path)];
  });
}

export function SkillFileTree({
  nodes,
  selectedPath,
  onSelect,
}: {
  nodes: TreeNode[];
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  const initialFolders = useMemo(() => collectFolderPaths(nodes), [nodes]);
  const [openFolders, setOpenFolders] = useState(() => new Set(initialFolders));

  const renderNodes = (items: TreeNode[], parentPath = "") => (
    <ul className="sd-filetree">
      {items.map((node) => {
        const path = parentPath ? `${parentPath}/${node.name}` : node.name;
        if (node.type === "folder") {
          const expanded = openFolders.has(path);
          return (
            <li key={path} className="ft-folder">
              <button
                type="button"
                className="sd-tree-row is-folder"
                aria-expanded={expanded}
                onClick={() =>
                  setOpenFolders((current) => {
                    const next = new Set(current);
                    if (expanded) next.delete(path);
                    else next.add(path);
                    return next;
                  })
                }
              >
                {expanded ? <ChevronDown /> : <ChevronRight />}
                {expanded ? <FolderOpen /> : <Folder />}
                <span>{node.name}</span>
              </button>
              {expanded && node.children?.length
                ? renderNodes(node.children, path)
                : null}
            </li>
          );
        }
        const selected = selectedPath === path;
        return (
          <li key={path} className="ft-file">
            <button
              type="button"
              className={`sd-tree-row${selected ? " is-selected" : ""}`}
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(path)}
            >
              <span className="sd-tree-spacer" />
              <FileText />
              <span>{node.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return renderNodes(nodes);
}
