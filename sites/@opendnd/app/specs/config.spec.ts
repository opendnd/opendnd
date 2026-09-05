import { describe, expect, it } from 'vitest';
import { LOCAL_API_URL, PUBLIC_API_URL, readConfig } from 'src/config';

describe('configuration', () => {
  it('defaults to development sign-in and the local API under the dev server', () => {
    expect(readConfig({ DEV: true })).toEqual({
      apiUrl: LOCAL_API_URL,
      auth: { mode: 'dev' },
    });
  });

  it('defaults a production build to Cognito, and refuses to sign in until it is named', () => {
    const config = readConfig({ DEV: false });
    expect(config.apiUrl).toBe(PUBLIC_API_URL);
    expect(config.auth.mode).toBe('none');
    if (config.auth.mode === 'none') {
      expect(config.auth.reason).toMatch(/VITE_COGNITO_DOMAIN/);
    }
  });

  it('uses Cognito when the pool and client are given', () => {
    expect(
      readConfig({
        DEV: false,
        VITE_COGNITO_DOMAIN: 'https://pool.auth.eu-west-1.amazoncognito.com/',
        VITE_COGNITO_CLIENT_ID: 'client-1',
      }).auth,
    ).toEqual({
      mode: 'cognito',
      domain: 'https://pool.auth.eu-west-1.amazoncognito.com',
      clientId: 'client-1',
    });
  });

  it('honours an explicit request for development sign-in in any build', () => {
    expect(readConfig({ DEV: false, VITE_AUTH: 'dev' }).auth).toEqual({
      mode: 'dev',
    });
  });

  it('refuses a mode it does not know', () => {
    expect(readConfig({ DEV: true, VITE_AUTH: 'magic' }).auth.mode).toBe(
      'none',
    );
  });

  it('trims trailing slashes from the API URL', () => {
    expect(readConfig({ VITE_API_URL: 'https://api.example/' }).apiUrl).toBe(
      'https://api.example',
    );
  });
});
