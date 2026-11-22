import { Fragment, type ReactNode } from "react";
import { XREF } from "@/ui/labels";
import { isFlaggedStatus, linkSegments, type CrossRefIndex, type XrefTarget } from "@/writing/crossRefs";
import type { Block, Inline, MarkdownDocument } from "@/writing/markdownParse";

/* Renders a parsed record body. Every value is passed to React as text; nothing is injected as HTML. */

/** An image attached to the record, looked up by the name the text uses. */
export interface AttachedImage {
  src: string;
  width: number;
  height: number;
  altText: string;
  caption: string;
}

export type AttachedImages = ReadonlyMap<string, AttachedImage>;

/** Links filenames and IDs in the text to the documents that define them. */
export interface CrossRefLinks {
  index: CrossRefIndex;
  href: (target: XrefTarget) => string;
}

interface RenderContext {
  images?: AttachedImages;
  /** Absent inside headings and existing links. */
  xrefs?: CrossRefLinks;
}

function isExternal(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim());
}

function targetTitle(t: XrefTarget): string {
  const title = t.anchor && t.label !== t.title ? `${t.title}: ${t.label}` : t.title;
  return XREF.linkTitle(title, isFlaggedStatus(t.status) ? t.status : null);
}

function XrefLink({ target, xrefs, children }: { target: XrefTarget; xrefs: CrossRefLinks; children: ReactNode }) {
  return (
    <a
      className="xref"
      href={xrefs.href(target)}
      title={targetTitle(target)}
      data-status={isFlaggedStatus(target.status) ? target.status : undefined}
    >
      {children}
    </a>
  );
}

function renderImage(node: Extract<Inline, { kind: "image" }>, images: AttachedImages | undefined, key: number): ReactNode {
  const image = images?.get(node.name);
  if (!image) {
    return (
      <span key={key} className="md-image-missing">
        Image not found: <code>image:{node.name}</code>
      </span>
    );
  }
  const alt = node.alt || image.altText || image.caption;
  return (
    <span key={key} className="md-image">
      <img src={image.src} alt={alt} width={image.width} height={image.height} loading="lazy" decoding="async" />
      {image.caption ? <span className="md-image-caption">{image.caption}</span> : null}
    </span>
  );
}

function renderText(text: string, ctx: RenderContext, key: number): ReactNode {
  const xrefs = ctx.xrefs;
  if (!xrefs) return <Fragment key={key}>{text}</Fragment>;
  const parts = linkSegments(text, xrefs.index);
  return (
    <Fragment key={key}>
      {parts.map((p, i) =>
        p.target ? (
          <XrefLink key={i} target={p.target} xrefs={xrefs}>
            {p.text}
          </XrefLink>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </Fragment>
  );
}

function renderCode(text: string, ctx: RenderContext, key: number): ReactNode {
  const parts = ctx.xrefs ? linkSegments(text.trim(), ctx.xrefs.index) : [];
  const target = parts.length === 1 ? parts[0].target : undefined;
  return target && ctx.xrefs ? (
    <XrefLink key={key} target={target} xrefs={ctx.xrefs}>
      <code>{text}</code>
    </XrefLink>
  ) : (
    <code key={key}>{text}</code>
  );
}

function renderInline(nodes: readonly Inline[], ctx: RenderContext): ReactNode {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case "image":
        return renderImage(node, ctx.images, i);
      case "text":
        return renderText(node.text, ctx, i);
      case "break":
        return <br key={i} />;
      case "code":
        return renderCode(node.text, ctx, i);
      case "strong":
        return <strong key={i}>{renderInline(node.children, ctx)}</strong>;
      case "em":
        return <em key={i}>{renderInline(node.children, ctx)}</em>;
      case "del":
        return <del key={i}>{renderInline(node.children, ctx)}</del>;
      case "link": {
        const inner = renderInline(node.children, { images: ctx.images });
        return isExternal(node.href) ? (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
            {inner}
          </a>
        ) : (
          <a key={i} href={node.href}>
            {inner}
          </a>
        );
      }
      case "footnoteRef":
        return (
          <sup key={i} className="md-footnote-ref">
            <a href={`#fn-${encodeURIComponent(node.id)}`} id={`fnref-${encodeURIComponent(node.id)}`}>
              {node.id}
            </a>
          </sup>
        );
    }
  });
}

function renderBlocks(blocks: readonly Block[], ctx: RenderContext, tight = false): ReactNode {
  return blocks.map((block, i) => {
    switch (block.kind) {
      case "heading": {
        // The record title is the page's h1, so the document's own headings start at h2.
        const Tag = `h${Math.min(6, block.level + 1)}` as "h2";
        return (
          <Tag key={i} id={block.id} className="md-heading" tabIndex={-1}>
            {renderInline(block.children, { images: ctx.images })}
          </Tag>
        );
      }
      case "paragraph":
        return tight ? (
          <Fragment key={i}>{renderInline(block.children, ctx)}</Fragment>
        ) : (
          <p key={i}>{renderInline(block.children, ctx)}</p>
        );
      case "list": {
        const items = block.items.map((item, j) => <li key={j}>{renderBlocks(item, ctx, block.tight)}</li>);
        return block.ordered ? (
          <ol key={i} start={block.start === 1 ? undefined : block.start}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        );
      }
      case "quote":
        return <blockquote key={i}>{renderBlocks(block.children, ctx)}</blockquote>;
      case "code":
        return (
          <pre key={i} tabIndex={0}>
            <code>{block.text}</code>
          </pre>
        );
      case "rule":
        return <hr key={i} />;
      case "footnote":
        return (
          <aside key={i} className="md-footnote" id={`fn-${encodeURIComponent(block.id)}`}>
            <span className="md-footnote-label">{block.id}.</span> {renderInline(block.children, ctx)}{" "}
            <a className="md-footnote-back" href={`#fnref-${encodeURIComponent(block.id)}`} aria-label="Back to reference">
              ↩
            </a>
          </aside>
        );
      case "table":
        return (
          <div key={i} className="md-table-wrap" tabIndex={0} role="region" aria-label="Table, scrolls sideways">
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, c) => (
                    <th key={c} scope="col" style={block.align[c] ? { textAlign: block.align[c]! } : undefined}>
                      {renderInline(cell, ctx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} style={block.align[c] ? { textAlign: block.align[c]! } : undefined}>
                        {renderInline(cell, ctx)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

export function MarkdownView({
  doc,
  className,
  images,
  xrefs,
}: {
  doc: MarkdownDocument;
  className?: string;
  images?: AttachedImages;
  xrefs?: CrossRefLinks;
}) {
  return <div className={className ? `markdown ${className}` : "markdown"}>{renderBlocks(doc.blocks, { images, xrefs })}</div>;
}
