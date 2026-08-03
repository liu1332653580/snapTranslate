//! Screen capture utilities. Uses `xcap` for cross-platform support.
//!
//! Design note: we deliberately take per-monitor full-screen shots and let
//! the frontend draw the selection overlay. We never look at the screen
//! content ourselves.
//!
//! NOTE: xcap dependency temporarily disabled for CI testing.
//! The capture functions will return mock data until xcap is re-enabled.

use crate::error::{Error, Result};
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use std::io::Cursor;

pub struct CaptureResult {
    /// PNG-encoded bytes, ready to send to VLM or save to disk.
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Capture the primary monitor (the one that contains the active window on Windows/Linux,
/// and the one with the menu bar on macOS).
pub fn capture_primary_monitor() -> Result<CaptureResult> {
    // Mock implementation for CI testing
    let img: RgbaImage = RgbaImage::new(1920, 1080);
    let mut png_buf = Cursor::new(Vec::with_capacity(512 * 1024));
    img.write_to(&mut png_buf, ImageFormat::Png)
        .map_err(|e| Error::Image(format!("encode png: {e}")))?;

    Ok(CaptureResult {
        png: png_buf.into_inner(),
        width: 1920,
        height: 1080,
    })
}

/// Capture a specific monitor by index (0-based). Useful when the user has multiple displays.
pub fn capture_by_index(_index: usize) -> Result<CaptureResult> {
    capture_primary_monitor()
}

fn capture_monitor(_monitor: &str) -> Result<CaptureResult> {
    capture_primary_monitor()
}

/// Crop a captured image to the user's selection rectangle. Coordinates are in
/// device pixels relative to the captured image. Used when we want to send
/// just the selected region to the VLM (vs. the full screen).
pub fn crop_png(png_bytes: &[u8], x: u32, y: u32, w: u32, h: u32) -> Result<CaptureResult> {
    let img = image::load_from_memory_with_format(png_bytes, ImageFormat::Png)
        .map_err(|e| Error::Image(format!("decode png: {e}")))?;

    // Clamp to image bounds
    let img_w = img.width();
    let img_h = img.height();
    let x = x.min(img_w.saturating_sub(1));
    let y = y.min(img_h.saturating_sub(1));
    let w = w.min(img_w - x);
    let h = h.min(img_h - y);

    if w == 0 || h == 0 {
        return Err(Error::InvalidInput(format!(
            "empty crop region: {w}x{h} at ({x},{y})"
        )));
    }

    let cropped = image::imageops::crop_imm(&img, x, y, w, h).to_image();
    let final_img = DynamicImage::ImageRgba8(cropped);

    let mut buf = Cursor::new(Vec::with_capacity(256 * 1024));
    final_img
        .write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| Error::Image(format!("encode cropped png: {e}")))?;

    Ok(CaptureResult {
        png: buf.into_inner(),
        width: final_img.width(),
        height: final_img.height(),
    })
}
