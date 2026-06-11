import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Home } from './pages/Home';
import { RangeTrainer } from './pages/RangeTrainer';
import { EquityCalc } from './pages/EquityCalc';
import { PotOdds } from './pages/PotOdds';
import { Quiz } from './pages/Quiz';
import { Cbet } from './pages/Cbet';
import { Versus } from './pages/Versus';
import { Stats } from './pages/Stats';
import { Review } from './pages/Review';
import { Sessions } from './pages/Sessions';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      { path: 'range', element: <RangeTrainer /> },
      { path: 'equity', element: <EquityCalc /> },
      { path: 'pot-odds', element: <PotOdds /> },
      { path: 'cbet', element: <Cbet /> },
      { path: 'quiz', element: <Quiz /> },
      { path: 'stats', element: <Stats /> },
      { path: 'review', element: <Review /> },
      { path: 'sessions', element: <Sessions /> },
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
