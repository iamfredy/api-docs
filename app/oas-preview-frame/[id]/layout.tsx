import type { ReactNode } from 'react';

export default function OasPreviewFrameLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[1400px] bg-fd-background px-4 py-6 text-fd-foreground md:px-8 md:py-10">
      {/*
        `prose` is what DocsBody applies on published pages. fumadocs-openapi emits bare
        h2/h3/p/table/pre elements whose typography lives entirely under `.prose :where(...)`,
        so without this wrapper Tailwind preflight leaves them unstyled and collapsed.
      */}
      <article className="prose min-w-0 max-w-none">{children}</article>
    </main>
  );
}
