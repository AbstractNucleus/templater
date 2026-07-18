//! Command-facing errors. IPC still surfaces `String`; this enum keeps
//! call sites typed and messages consistent.

use std::fmt;

#[derive(Debug)]
pub enum AppError {
    Msg(String),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Msg(s.into())
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Msg(s) => write!(f, "{s}"),
        }
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        Self::Msg(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        Self::Msg(s.to_string())
    }
}

/// Map `AppError` → `String` for `#[tauri::command]` return types.
pub fn cmd_err(e: impl Into<AppError>) -> String {
    e.into().into()
}
