/**
 * A world's geography as data.
 *
 * A world arrives one of two ways: somebody drew it, or nobody has yet. This
 * package is where the first becomes the second's equal — the shapes are read
 * out of the drawing and become the same coastline a generated world would
 * have produced, so everything downstream stops caring which it was.
 */
export * from './path-data';
export * from './svg-map';
export * from './fit';
export * from './raster';
export * from './coverage';
