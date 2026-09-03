// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

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
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/opendnd/opendnd' },
      ],
      sidebar: [
        { label: 'Overview', slug: '' },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Packages', items: [{ autogenerate: { directory: 'packages' } }] },
        { label: 'Research', items: [{ autogenerate: { directory: 'research' } }] },
        {
          label: 'Architecture decisions',
          items: [{ autogenerate: { directory: 'adr' } }],
        },
      ],
    }),
  ],
});
