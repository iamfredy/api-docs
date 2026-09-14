import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const hideSidebar = slug?.[0] === 'oas-to-api-doc-generator';

  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      sidebar={{ enabled: !hideSidebar }}
    >
      {children}
    </DocsLayout>
  );
}
