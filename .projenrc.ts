import { configureDocsSite } from './projenrc/docs-site';
import { configurePackages } from './projenrc/packages';
import { configureRootProject } from './projenrc/root-project';

/**
 * The root project is a management container. The real work lives in
 * packages/@opendnd/*, apps/@opendnd/*, sites/@opendnd/* and the single
 * Starlight docs site at /docs.
 */
const rootProject = configureRootProject();

/**
 * Shared libraries under packages/@opendnd/*.
 */
configurePackages(rootProject);

/**
 * The monorepo-wide docs site (research, ADRs, guides, package docs).
 */
configureDocsSite(rootProject);

/**
 * Build tsconfig path mappings for every workspace.
 */
rootProject.buildWorkspacePaths();

/**
 * Wire `bun run dev` to turbo.
 */
rootProject.configureDevScripts();

rootProject.synth();
