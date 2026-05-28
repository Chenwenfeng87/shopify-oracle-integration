import { useCallback, useContext, useMemo } from 'react';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import {
  useQuery,
  useMutation,
  UseQueryOptions,
  UseMutationOptions,
  QueryKey,
} from '@tanstack/react-query';
import { AppContext } from '../App';

// ============================================================================
// API Types
// ============================================================================

export interface ApiError {
  status: number;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message?: string;
  errors?: string[];
}

// ============================================================================
// Axios Instance Factory
// ============================================================================

let apiInstance: AxiosInstance | null = null;

function createApiInstance(): AxiosInstance {
  const baseURL = import.meta.env.VITE_API_URL || '/api';

  const instance = axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor: attach shop domain from App Bridge
  instance.interceptors.request.use(
    (config) => {
      const shopParam = new URLSearchParams(window.location.search).get('shop');
      if (shopParam) {
        config.params = { ...config.params, shop: shopParam };
      }

      // Attach session token if available from App Bridge
      const sessionToken = (window as unknown as Record<string, unknown>).__shopifySessionToken;
      if (sessionToken) {
        config.headers.Authorization = `Bearer ${sessionToken}`;
      }

      return config;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor: normalize errors
  instance.interceptors.response.use(
    (response) => response,
    (error: AxiosError<ApiResponse>) => {
      if (error.response) {
        const apiError: ApiError = {
          status: error.response.status,
          message:
            error.response.data?.message ||
            error.response.data?.errors?.join(', ') ||
            error.message ||
            'An unexpected error occurred',
          details: error.response.data as Record<string, unknown>,
        };
        return Promise.reject(apiError);
      }

      if (error.request) {
        return Promise.reject({
          status: 0,
          message: 'Network error. Please check your connection and try again.',
        } as ApiError);
      }

      return Promise.reject({
        status: -1,
        message: error.message || 'An unexpected error occurred',
      } as ApiError);
    }
  );

  return instance;
}

function getApiInstance(): AxiosInstance {
  if (!apiInstance) {
    apiInstance = createApiInstance();
  }
  return apiInstance;
}

// ============================================================================
// useApi Hook
// ============================================================================

export function useApi() {
  const { showToast } = useContext(AppContext);
  const client = useMemo(() => getApiInstance(), []);

  const handleError = useCallback(
    (error: unknown) => {
      const apiError = error as ApiError;
      const message = apiError?.message || 'An unexpected error occurred';
      showToast(message, { error: true });
      return apiError;
    },
    [showToast]
  );

  /**
   * Execute a GET request directly.
   */
  const get = useCallback(
    async <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> => {
      try {
        const response: AxiosResponse<ApiResponse<T>> = await client.get(url, config);
        return (response.data as ApiResponse<T>).data ?? (response.data as T);
      } catch (error) {
        throw handleError(error);
      }
    },
    [client, handleError]
  );

  /**
   * Execute a POST request directly.
   */
  const post = useCallback(
    async <T = unknown>(
      url: string,
      data?: unknown,
      config?: AxiosRequestConfig
    ): Promise<T> => {
      try {
        const response: AxiosResponse<ApiResponse<T>> = await client.post(url, data, config);
        return (response.data as ApiResponse<T>).data ?? (response.data as T);
      } catch (error) {
        throw handleError(error);
      }
    },
    [client, handleError]
  );

  /**
   * Execute a PUT request directly.
   */
  const put = useCallback(
    async <T = unknown>(
      url: string,
      data?: unknown,
      config?: AxiosRequestConfig
    ): Promise<T> => {
      try {
        const response: AxiosResponse<ApiResponse<T>> = await client.put(url, data, config);
        return (response.data as ApiResponse<T>).data ?? (response.data as T);
      } catch (error) {
        throw handleError(error);
      }
    },
    [client, handleError]
  );

  /**
   * Execute a DELETE request directly.
   */
  const del = useCallback(
    async <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> => {
      try {
        const response: AxiosResponse<ApiResponse<T>> = await client.delete(url, config);
        return (response.data as ApiResponse<T>).data ?? (response.data as T);
      } catch (error) {
        throw handleError(error);
      }
    },
    [client, handleError]
  );

  /**
   * React Query hook for GET requests with automatic caching and error handling.
   */
  const useGetQuery = useCallback(
    <T = unknown>(
      queryKey: QueryKey,
      url: string,
      config?: AxiosRequestConfig,
      options?: Omit<UseQueryOptions<T, ApiError, T, QueryKey>, 'queryKey' | 'queryFn'>
    ) => {
      return useQuery<T, ApiError>({
        queryKey,
        queryFn: async () => {
          try {
            const response: AxiosResponse<ApiResponse<T>> = await client.get(url, config);
            return (response.data as ApiResponse<T>).data ?? (response.data as T);
          } catch (error) {
            throw handleError(error);
          }
        },
        ...options,
      });
    },
    [client, handleError]
  );

  /**
   * React Query hook for POST mutations.
   */
  const usePostMutation = useCallback(
    <TData = unknown, TVariables = unknown>(
      url: string,
      options?: Omit<
        UseMutationOptions<TData, ApiError, TVariables>,
        'mutationFn'
      >
    ) => {
      return useMutation<TData, ApiError, TVariables>({
        mutationFn: async (variables) => {
          try {
            const response: AxiosResponse<ApiResponse<TData>> = await client.post(
              url,
              variables
            );
            return (response.data as ApiResponse<TData>).data ?? (response.data as TData);
          } catch (error) {
            throw handleError(error);
          }
        },
        ...options,
      });
    },
    [client, handleError]
  );

  /**
   * React Query hook for PUT mutations.
   */
  const usePutMutation = useCallback(
    <TData = unknown, TVariables = unknown>(
      url: string,
      options?: Omit<
        UseMutationOptions<TData, ApiError, TVariables>,
        'mutationFn'
      >
    ) => {
      return useMutation<TData, ApiError, TVariables>({
        mutationFn: async (variables) => {
          try {
            const response: AxiosResponse<ApiResponse<TData>> = await client.put(
              url,
              variables
            );
            return (response.data as ApiResponse<TData>).data ?? (response.data as TData);
          } catch (error) {
            throw handleError(error);
          }
        },
        ...options,
      });
    },
    [client, handleError]
  );

  return {
    client,
    get,
    post,
    put,
    del,
    useGetQuery,
    usePostMutation,
    usePutMutation,
  };
}
