/**
 * Combined auth middleware re-exports.
 *
 * This file serves as the single import point for all authentication-related
 * middleware. Route files import from here rather than from individual
 * middleware files to keep imports clean and centralized.
 */

export { shopifyAuth } from './shopify-auth';
export default shopifyAuth;
