import { CreditLimitCalculator } from '@/components/credit-limit-calculator';
import { CreditCalculator } from '@/components/credit-calculator';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { APIPage } from '@/components/api-page';
import { DocsWithSamples, SamplePanel, SamplePanelTitle, ShikiCode, ParamsTable } from '@/components/docs-with-samples';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    APIPage,
    DocsWithSamples,
    SamplePanel,
    SamplePanelTitle,
    ShikiCode,
    ParamsTable,
CreditCalculator,
CreditLimitCalculator,
    ...components,
  };
}
