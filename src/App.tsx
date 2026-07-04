import { lazy } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Home } from './pages/Home';

const Guide = lazy(() => import('./pages/Guide').then((m) => ({ default: m.Guide })));
const RangeTrainer = lazy(() => import('./pages/RangeTrainer').then((m) => ({ default: m.RangeTrainer })));
const EquityCalc = lazy(() => import('./pages/EquityCalc').then((m) => ({ default: m.EquityCalc })));
const PotOdds = lazy(() => import('./pages/PotOdds').then((m) => ({ default: m.PotOdds })));
const Quiz = lazy(() => import('./pages/Quiz').then((m) => ({ default: m.Quiz })));
const PerceivedRange = lazy(() => import('./pages/PerceivedRange').then((m) => ({ default: m.PerceivedRange })));
const Cbet = lazy(() => import('./pages/Cbet').then((m) => ({ default: m.Cbet })));
const Versus = lazy(() => import('./pages/Versus').then((m) => ({ default: m.Versus })));
const Stats = lazy(() => import('./pages/Stats').then((m) => ({ default: m.Stats })));
const Review = lazy(() => import('./pages/Review').then((m) => ({ default: m.Review })));
const Sessions = lazy(() => import('./pages/Sessions').then((m) => ({ default: m.Sessions })));
const Glossary = lazy(() => import('./pages/Glossary').then((m) => ({ default: m.Glossary })));
const Online = lazy(() => import('./pages/Online').then((m) => ({ default: m.Online })));

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      { path: 'guide', element: <Guide /> },
      { path: 'range', element: <RangeTrainer /> },
      { path: 'equity', element: <EquityCalc /> },
      { path: 'pot-odds', element: <PotOdds /> },
      { path: 'cbet', element: <Cbet /> },
      { path: 'quiz', element: <Quiz /> },
      { path: 'perceived', element: <PerceivedRange /> },
      { path: 'stats', element: <Stats /> },
      { path: 'review', element: <Review /> },
      { path: 'glossary', element: <Glossary /> },
      { path: 'sessions', element: <Sessions /> },
      { path: 'online', element: <Online /> },
      {
        path: 'versus',
        children: [
          { index: true, element: <Versus /> },
          { path: 'history', element: <Versus /> },
          { path: 'history/:id', element: <Versus /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
