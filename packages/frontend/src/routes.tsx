import React from 'react';
import { RouteObject } from 'react-router-dom';
import App from './App';
import { DashboardPage } from './pages/Dashboard/DashboardPage';
import { CredentialsSetup } from './pages/Configuration/CredentialsSetup';
import { FieldMapping } from './pages/Configuration/FieldMapping';
import { SyncFrequency } from './pages/Configuration/SyncFrequency';
import { SyncOverview } from './pages/Sync/SyncOverview';
import { ManualSync } from './pages/Sync/ManualSync';
import { SyncJobDetail } from './pages/Sync/SyncJobDetail';
import { LogViewer } from './pages/Logs/LogViewer';
import { BillingPage } from './pages/Billing/BillingPage';
import { SettingsPage } from './pages/Settings/SettingsPage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'configuration/credentials', element: <CredentialsSetup /> },
      { path: 'configuration/field-mapping', element: <FieldMapping /> },
      { path: 'configuration/sync-frequency', element: <SyncFrequency /> },
      { path: 'sync/overview', element: <SyncOverview /> },
      { path: 'sync/manual', element: <ManualSync /> },
      { path: 'sync/jobs/:jobId', element: <SyncJobDetail /> },
      { path: 'logs', element: <LogViewer /> },
      { path: 'billing', element: <BillingPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
];
