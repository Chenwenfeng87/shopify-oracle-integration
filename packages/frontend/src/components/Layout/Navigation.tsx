import React, { useCallback } from 'react';
import {
  Navigation as PolarisNavigation,
  Icon,
} from '@shopify/polaris';
import {
  HomeIcon,
  GlobeIcon,
  ArrowRightIcon,
  ClockIcon,
  ViewListIcon,
  ReportIcon,
  CurrencyIcon,
  SettingsIcon,
  CircleIcon,
} from '@shopify/polaris-icons';

export interface NavigationProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

/**
 * Main navigation component for the Shopify-Oracle Integration app.
 * Provides the full Polaris Navigation sidebar with all menu items.
 */
export function Navigation({ currentPath, onNavigate }: NavigationProps) {
  const isActive = useCallback(
    (path: string) => {
      if (path === '/') {
        return currentPath === '/';
      }
      return currentPath.startsWith(path);
    },
    [currentPath]
  );

  return (
    <PolarisNavigation location="/">
      <PolarisNavigation.Section
        items={[
          {
            label: 'Dashboard',
            icon: HomeIcon,
            onClick: () => onNavigate('/'),
            selected: isActive('/') && currentPath === '/',
          },
        ]}
      />

      <PolarisNavigation.Section
        title="Configuration"
        items={[
          {
            label: 'Oracle Credentials',
            icon: GlobeIcon,
            onClick: () => onNavigate('/configuration/credentials'),
            selected: isActive('/configuration/credentials'),
          },
          {
            label: 'Field Mapping',
            icon: ArrowRightIcon,
            onClick: () => onNavigate('/configuration/field-mapping'),
            selected: isActive('/configuration/field-mapping'),
          },
          {
            label: 'Sync Frequency',
            icon: ClockIcon,
            onClick: () => onNavigate('/configuration/sync-frequency'),
            selected: isActive('/configuration/sync-frequency'),
          },
        ]}
      />

      <PolarisNavigation.Section
        title="Synchronization"
        items={[
          {
            label: 'Sync Overview',
            icon: ViewListIcon,
            onClick: () => onNavigate('/sync/overview'),
            selected: isActive('/sync/overview'),
          },
          {
            label: 'Manual Sync',
            icon: CircleIcon,
            onClick: () => onNavigate('/sync/manual'),
            selected: isActive('/sync/manual'),
          },
        ]}
      />

      <PolarisNavigation.Section
        title="Monitoring"
        items={[
          {
            label: 'Sync Logs',
            icon: ReportIcon,
            onClick: () => onNavigate('/logs'),
            selected: isActive('/logs'),
          },
        ]}
      />

      <PolarisNavigation.Section
        title="Account"
        items={[
          {
            label: 'Billing',
            icon: CurrencyIcon,
            onClick: () => onNavigate('/billing'),
            selected: isActive('/billing'),
          },
          {
            label: 'Settings',
            icon: SettingsIcon,
            onClick: () => onNavigate('/settings'),
            selected: isActive('/settings'),
          },
        ]}
      />
    </PolarisNavigation>
  );
}
