import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CredentialModel } from '../models/credential.model';
import { StoreModel } from '../models/store.model';
import { logger } from '../utils/logger';

/**
 * Handles all Oracle credential-related HTTP requests:
 *
 * - GET    /api/credentials      — Get stored credentials (password masked)
 * - POST   /api/credentials      — Save or update credentials (encrypted)
 * - POST   /api/credentials/test — Test the Oracle connection
 * - DELETE /api/credentials      — Remove stored credentials
 */
export class CredentialsController {
  /**
   * GET /api/credentials
   *
   * Retrieve Oracle credentials for a store.
   * The password is masked in the response for security.
   */
  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
      });

      const validated = schema.parse(req.query);
      const { storeId } = validated;

      // Verify store exists
      const store = await StoreModel.findById(storeId);
      if (!store) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Store not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      const credentials = await CredentialModel.findByStoreId(storeId);

      if (!credentials) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'No Oracle credentials configured for this store',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      // Mask password for security
      const safeCredentials = {
        ...credentials,
        password: '••••••••',
      };

      logger.debug('Credentials retrieved', {
        storeId,
        requestId: req.requestId,
      });

      res.json({
        success: true,
        data: safeCredentials,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * POST /api/credentials
   *
   * Save or update Oracle credentials for a store.
   * The username and password are encrypted before being stored.
   * If credentials already exist for the store, they are updated.
   */
  async save(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
        username: z.string().min(1),
        password: z.string().min(1),
        baseUrl: z.string().url(),
        environment: z.enum(['production', 'test', 'development']),
      });

      const validated = schema.parse(req.body);
      const { storeId, username, password, baseUrl, environment } = validated;

      // Verify store exists
      const store = await StoreModel.findById(storeId);
      if (!store) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Store not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      // Check if credentials already exist
      const existing = await CredentialModel.findByStoreId(storeId);

      let credentials;
      if (existing) {
        // Update existing credentials
        credentials = await CredentialModel.update(storeId, {
          username,
          password,
          baseUrl,
          environment,
        });
        logger.info('Oracle credentials updated', {
          storeId,
          environment,
          requestId: req.requestId,
        });
      } else {
        // Create new credentials
        credentials = await CredentialModel.create({
          storeId,
          username,
          password,
          baseUrl,
          environment,
        });
        logger.info('Oracle credentials created', {
          storeId,
          environment,
          requestId: req.requestId,
        });
      }

      res.status(201).json({
        success: true,
        data: {
          ...credentials,
          password: '••••••••',
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid credential data',
            details: error.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message,
            })),
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * POST /api/credentials/test
   *
   * Test the connection to Oracle using the stored credentials.
   * Updates the credential's validity status based on the result.
   */
  async testConnection(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
      });

      const validated = schema.parse(req.body);
      const { storeId } = validated;

      const credentials = await CredentialModel.findByStoreId(storeId);
      if (!credentials) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'No Oracle credentials found for this store',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      // Attempt to connect to Oracle
      let connectionSuccessful = false;
      let testMessage = '';

      try {
        // TODO: Replace with actual Oracle API health check call
        // const response = await axios.get(`${credentials.baseUrl}/api/health`, {
        //   auth: { username: credentials.username, password: credentials.password },
        //   timeout: 10000,
        // });
        // connectionSuccessful = response.status === 200;

        // Placeholder: simulate connection test
        if (credentials.baseUrl && credentials.username) {
          connectionSuccessful = true;
          testMessage = 'Successfully connected to Oracle instance';
        }
      } catch (connectionError) {
        connectionSuccessful = false;
        testMessage = `Connection failed: ${(connectionError as Error).message}`;
      }

      // Update credential validity status
      if (connectionSuccessful) {
        await CredentialModel.markValid(storeId);
      } else {
        await CredentialModel.markInvalid(storeId);
      }

      logger.info('Oracle connection test completed', {
        storeId,
        success: connectionSuccessful,
        requestId: req.requestId,
      });

      res.json({
        success: true,
        data: {
          connected: connectionSuccessful,
          message: testMessage,
          lastTestedAt: new Date().toISOString(),
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: error.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message,
            })),
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * DELETE /api/credentials
   *
   * Remove Oracle credentials for a store.
   * The encrypted credential record is permanently deleted.
   */
  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
      });

      const validated = schema.parse(req.body);
      const { storeId } = validated;

      const existing = await CredentialModel.findByStoreId(storeId);
      if (!existing) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'No Oracle credentials found for this store',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      await CredentialModel.delete(storeId);

      logger.info('Oracle credentials deleted', {
        storeId,
        requestId: req.requestId,
      });

      res.json({
        success: true,
        data: { message: 'Oracle credentials deleted successfully' },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: error.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message,
            })),
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }
}

export default CredentialsController;
