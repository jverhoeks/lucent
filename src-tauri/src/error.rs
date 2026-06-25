use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    NotFound,
    Unreadable,
    NotUtf8,
    Io,
}

#[derive(Debug, Serialize, Clone)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}
