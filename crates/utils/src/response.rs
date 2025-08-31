use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
pub struct ApiResponse<T, E = T> {
    success: bool,
    data: Option<T>,
    error_data: Option<E>,
    message: Option<String>,
}

impl<T, E> ApiResponse<T, E> {
    /// Creates a successful response, with `data` and no message.
    pub fn success(data: T) -> Self {
        ApiResponse {
            success: true,
            data: Some(data),
            message: None,
            error_data: None,
        }
    }

    /// Creates an error response, with `message` and no data.
    pub fn error(message: &str) -> Self {
        ApiResponse {
            success: false,
            data: None,
            message: Some(message.to_string()),
            error_data: None,
        }
    }
    /// Creates an error response, with no `data`, no `message`, but with arbitrary `error_data`.
    pub fn error_with_data(data: E) -> Self {
        ApiResponse {
            success: false,
            data: None,
            error_data: Some(data),
            message: None,
        }
    }
}
