import { type ReactNode } from 'react';
import * as Separator from '@radix-ui/react-separator';
import { codeToHtml } from 'shiki';
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'fumadocs-ui/components/tabs';

export function DocsWithSamples({
  children,
  samples,
}: {
  children: ReactNode;
  samples: ReactNode;
}) {
  return (
    <div className="not-prose -mx-4 md:-mx-8 lg:-mx-12">
      <div className="@container px-4 md:px-8 lg:px-12">
        <div className="flex flex-col gap-x-6 gap-y-4 @4xl:flex-row @4xl:items-start text-sm">
          <div className="flex flex-col min-w-0 flex-1 prose dark:prose-invert max-w-none">
            {children}
          </div>
          <div className="@4xl:sticky @4xl:top-[calc(var(--fd-docs-row-1,2rem)+1rem)] @4xl:w-[400px] flex flex-col gap-4 text-xs min-w-0 shrink-0">
            {samples}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SamplePanel({ children }: { children: ReactNode }) {
  return (
    <div className="p-3 rounded-xl border bg-fd-card text-fd-card-foreground shadow-md flex flex-col gap-2">
      {children}
    </div>
  );
}

export function SamplePanelTitle({ children }: { children: ReactNode }) {
  return (
    <p className="font-semibold border-b pb-2 text-fd-primary text-xs">
      {children}
    </p>
  );
}

export async function ShikiCode({ code, lang }: { code: string; lang: string }) {
  const html = await codeToHtml(code, {
    lang,
    themes: {
      light: 'github-light',
      dark: 'github-dark',
    },
    defaultColor: false,
  });
  return (
    <CodeBlock>
      <Pre dangerouslySetInnerHTML={{ __html: html }} />
    </CodeBlock>
  );
}

interface ParamRow {
  name: string;
  type?: string;
  required?: boolean;
  description: ReactNode;
}

export function ParamsTable({ params }: { params: ParamRow[] }) {
  return (
    <div className="not-prose border rounded-xl text-sm overflow-hidden">
      <div className="grid grid-cols-[1fr_2fr] bg-fd-muted/50">
        <div className="px-4 py-2 font-semibold text-fd-foreground text-xs uppercase tracking-wide">Attribute</div>
        <div className="px-4 py-2 font-semibold text-fd-foreground text-xs uppercase tracking-wide">Description</div>
      </div>
      <Separator.Root className="h-px bg-fd-border" />
      {params.map((param, i) => (
        <div key={param.name}>
          {i > 0 && <Separator.Root className="h-px bg-fd-border" />}
          <div className="grid grid-cols-[1fr_2fr]">
            <div className="px-4 py-3 flex flex-col gap-1 border-r border-fd-border">
              <span className="font-medium font-mono text-fd-primary">{param.name}</span>
              {param.type && (
                <span className="text-xs font-mono text-fd-muted-foreground">{param.type}</span>
              )}
              {param.required && (
                <span className="border px-2 py-0.5 rounded-lg text-xs text-red-500 border-red-300 w-fit">required</span>
              )}
            </div>
            <div className="px-4 py-3 text-fd-muted-foreground">{param.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
