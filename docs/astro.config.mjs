// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';

export default defineConfig({
  site: 'https://docs.opendnd.org',
  output: 'static',
  integrations: [
    starlight({
      title: 'OpenDnD',
      description:
        'An open ontology, headless API and toolset for building fictional worlds. An OpenHI project.',
      editLink: {
        baseUrl: 'https://github.com/opendnd/opendnd/edit/next/docs/',
      },
      lastUpdated: true,
      // The OpenAPI description is generated into public/ by `bun run generate`
      // from the same Zod schemas the routes validate with, so these pages
      // cannot say anything the API does not accept.
      plugins: [
        starlightOpenAPI([
          { base: 'api', schema: './public/openapi.json', label: 'API reference' },
        ]),
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/opendnd/opendnd' },
      ],
      sidebar: [
        { label: 'Overview', slug: '' },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Packages', items: [{ autogenerate: { directory: 'packages' } }] },
        { label: 'Research', items: [{ autogenerate: { directory: 'research' } }] },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }],
        },
        ...openAPISidebarGroups,
        {
          label: 'Architecture decisions',
          items: [{ autogenerate: { directory: 'adr' } }],
        },
      ],
    }),
  ],
});
