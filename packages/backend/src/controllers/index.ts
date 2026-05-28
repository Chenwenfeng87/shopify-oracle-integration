/**
 * Barrel export for all controllers.
 *
 * Import from this file to get all controller classes in a single import:
 *
 * @example
 * import { AuthController, SyncController, MappingController } from '../controllers';
 */

export { AuthController } from './auth.controller';
export { SyncController } from './sync.controller';
export { MappingController } from './mapping.controller';
export { CredentialsController } from './credentials.controller';
export { DashboardController } from './dashboard.controller';
export { BillingController } from './billing.controller';
export { WebhookController } from './webhook.controller';

/**
 * Controller instance factory.
 *
 * Provides a simple way to create singleton instances of each controller.
 * Callers can also instantiate controllers directly with `new` if they need
 * custom constructor arguments.
 */
export const controllers = {
  auth: new AuthController(),
  sync: new SyncController(),
  mapping: new MappingController(),
  credentials: new CredentialsController(),
  dashboard: new DashboardController(),
  billing: new BillingController(),
  webhook: new WebhookController(),
} as const;

export default controllers;
