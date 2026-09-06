import { Navigate, type RouteObject } from 'react-router';
import { RequireSession, Shell } from './components/Layout';
import { Callback } from './pages/Callback';
import { Edit } from './pages/Edit';
import { ErrorPage } from './pages/ErrorPage';
import { Generate } from './pages/Generate';
import { Record } from './pages/Record';
import { Records } from './pages/Records';
import { Search } from './pages/Search';
import { SignIn } from './pages/SignIn';
import { WorldHome } from './pages/WorldHome';
import { WorldLayout } from './pages/WorldLayout';
import { Worlds } from './pages/Worlds';

/**
 * The route table. Content pages take the model from the address, so a model
 * added to the ontology has its pages the moment the API serves it.
 */
export const routes: RouteObject[] = [
  {
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to="/worlds" replace /> },
      { path: 'sign-in', element: <SignIn /> },
      { path: 'callback', element: <Callback /> },
      {
        element: <RequireSession />,
        children: [
          {
            element: <Shell />,
            children: [
              { path: 'worlds', element: <Worlds /> },
              {
                path: 'worlds/:world',
                element: <WorldLayout />,
                children: [
                  { index: true, element: <WorldHome /> },
                  { path: 'search', element: <Search /> },
                  { path: ':model', element: <Records /> },
                  { path: ':model/new', element: <Edit /> },
                  { path: ':model/generate', element: <Generate /> },
                  { path: ':model/:id', element: <Record /> },
                  { path: ':model/:id/edit', element: <Edit /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];
