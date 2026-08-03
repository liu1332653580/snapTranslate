import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";

interface MarkdownViewProps {
  content: string;
  className?: string;
}

/** Markdown renderer with GFM tables, KaTeX math, and safe defaults. */
export const MarkdownView = memo(function MarkdownView({
  content,
  className,
}: MarkdownViewProps) {
  if (!content?.trim()) {
    return (
      <div className="text-sm text-muted-foreground italic">
        (没有识别到文字)
      </div>
    );
  }
  return (
    <div className={cn("markdown-body", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
