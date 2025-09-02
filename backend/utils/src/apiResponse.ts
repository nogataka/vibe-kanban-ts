/**
 * Standard API Response format matching Rust implementation
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data: T | null;
  error_data: any | null;
  message: string | null;
}

/**
 * Create a success response
 */
export function successResponse<T>(data: T, message?: string): ApiResponse<T> {
  return {
    success: true,
    data,
    error_data: null,
    message: message || null
  };
}

/**
 * Create an error response
 */
export function errorResponse(message: string, errorData?: any): ApiResponse<null> {
  return {
    success: false,
    data: null,
    error_data: errorData || null,
    message
  };
}

/**
 * Create a validation error response
 */
export function validationErrorResponse(errors: any): ApiResponse<null> {
  return {
    success: false,
    data: null,
    error_data: errors,
    message: 'Validation failed'
  };
}