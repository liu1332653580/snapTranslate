//! Error type that crosses the IPC boundary. Tauri requires errors to be
//! `Serialize`; we use a stringly-typed wrapper so the frontend gets a
//! human-readable message and a stable `kind` it can switch on.

use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("capture: {0}")]
    Capture(String),

    #[error("image: {0}")]
    Image(String),

    #[error("vlm: {0}")]
    Vlm(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("config: {0}")]
    Config(String),

    #[error("not found")]
    NotFound,

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("upstream returned {status}: {body}")]
    Upstream { status: u16, body: String },

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
