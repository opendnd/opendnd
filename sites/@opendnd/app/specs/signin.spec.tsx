import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it } from 'vitest';
import { type AppServices, AppProvider } from 'src/app/context';
import { SignIn } from 'src/pages/SignIn';
import { fakeFetch, testServices } from './helpers';

function renderSignIn(services: AppServices) {
  const router = createMemoryRouter(
    [
      { path: '/sign-in', element: <SignIn /> },
      { path: '/worlds', element: <p>the worlds page</p> },
    ],
    { initialEntries: ['/sign-in'] },
  );
  return render(
    <AppProvider services={services}>
      <RouterProvider router={router} />
    </AppProvider>,
  );
}

describe('signing in', () => {
  it('takes any name in development mode and moves on', async () => {
    const user = userEvent.setup();
    const services = testServices(fakeFetch().fetch);
    services.sessions.clear();
    renderSignIn(services);

    await user.type(screen.getByLabelText('Any name'), 'drew');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(services.sessions.read()).toMatchObject({
      mode: 'dev',
      subject: 'drew',
      token: 'dev:drew',
    });
    expect(await screen.findByText('the worlds page')).toBeInTheDocument();
  });

  it('says nothing about a session when the user simply signed out', () => {
    const services = testServices(fakeFetch().fetch);
    services.sessions.clear();
    renderSignIn(services);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a refused development token and how to fix the API', () => {
    const services = testServices(fakeFetch().fetch);
    services.sessions.clear('unauthorized');
    renderSignIn(services);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The API refused the sign-in');
    expect(alert).toHaveTextContent('OPENDND_DEV_AUTH=on');
    expect(alert).toHaveTextContent('bunx projen dev');
  });

  it('explains an expired session', () => {
    const services = testServices(fakeFetch().fetch);
    services.sessions.clear('expired');
    renderSignIn(services);
    expect(screen.getByRole('alert')).toHaveTextContent('Your session expired');
  });
});
