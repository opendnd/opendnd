import { Navigate, type RouteObject } from 'react-router';
import { RequireSession, Shell } from './components/Layout';
import { Author } from './pages/Author';
import { Callback } from './pages/Callback';
import { Campaigns } from './pages/Campaigns';
import { Characters } from './pages/Characters';
import { Compendium } from './pages/Compendium';
import { Data } from './pages/Data';
import { Edit } from './pages/Edit';
import { ErrorPage } from './pages/ErrorPage';
import { Generate } from './pages/Generate';
import { MapPage } from './pages/Map';
import { Marketplace } from './pages/Marketplace';
import { Record } from './pages/Record';
import { Records } from './pages/Records';
import { Settings } from './pages/Settings';
import { SignIn } from './pages/SignIn';
import { Simulate } from './pages/Simulate';
import { Timeline } from './pages/Timeline';
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
                  { path: 'search', element: <Compendium /> },
                  { path: 'compendium', element: <Compendium /> },
                  { path: 'campaigns', element: <Campaigns /> },
                  { path: 'characters', element: <Characters /> },
                  { path: 'marketplace', element: <Marketplace /> },
                  { path: 'data', element: <Data /> },
                  { path: 'map', element: <MapPage /> },
                  { path: 'timeline', element: <Timeline /> },
                  { path: 'settings', element: <Settings /> },
                  { path: ':model', element: <Records /> },
                  { path: ':model/new', element: <Edit /> },
                  { path: ':model/generate', element: <Generate /> },
                  { path: ':model/:id', element: <Record /> },
                  { path: ':model/:id/edit', element: <Edit /> },
                  { path: ':model/:id/simulate', element: <Simulate /> },
                  { path: ':model/:id/author', element: <Author /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];
