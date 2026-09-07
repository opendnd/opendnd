import type { ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Long prose on a record, rendered from Markdown. Links to the wider web
 * open in a new tab; a link with nowhere to go, a wiki's own page name say,
 * stays as its words, and an image that is not an address is left out rather
 * than shown broken.
 */
export function Markdown(props: {
  readonly text: string;
  readonly className?: string;
}) {
  return (
    <div className={props.className ?? 'prose-record'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: (link: ComponentProps<'a'>) =>
            /^https?:\/\//.test(link.href ?? '') ? (
              <a href={link.href} target="_blank" rel="noreferrer noopener">
                {link.children}
              </a>
            ) : (
              <span>{link.children}</span>
            ),
          img: (image: ComponentProps<'img'>) =>
            /^https?:\/\//.test(image.src ?? '') ? (
              <img src={image.src} alt={image.alt ?? ''} loading="lazy" />
            ) : null,
        }}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}
