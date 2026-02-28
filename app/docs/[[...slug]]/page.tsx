import { source } from '@/lib/source';
import { DocsPage, DocsBody } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import { APIPage } from '@/components/api-page';

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  // OpenAPI pages — three panel layout
  if (page.data.type === 'openapi') {
    return (
      <DocsPage full>
        <DocsBody>
          <h1 className="text-[1.75em] font-semibold">{page.data.title}</h1>
          <APIPage {...page.data.getAPIPageProps()} />
        </DocsBody>
      </DocsPage>
    );
  }

  // Regular MDX pages
  const MDX = page.data.body;
  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsBody>
        <h1>{page.data.title}</h1>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}
