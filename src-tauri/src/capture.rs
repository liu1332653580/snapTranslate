//! Screen capture utilities. Uses `xcap` for cross-platform support.
//!
//! Design note: we deliberately take per-monitor full-screen shots and let
//! the frontend draw the selection overlay. We never look at the screen
//! content ourselves.

use crate::error::{Error, Result};
use image::{DynamicImage, ImageFormat};
use std::io::Cursor;
use xcap::Monitor;

pub struct CaptureResult {
    /// PNG-encoded bytes, ready to send to VLM or save to disk.
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Capture the primary monitor (the one that contains the active window on Windows/Linux,
/// and the one with the menu bar on macOS).
pub fn capture_primary_monitor() -> Result<CaptureResult> {
    let monitors = Monitor::all().map_err(|e| Error::Capture(format!("list monitors: {e}")))?;

    let primary = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| {
            // xcap may not flag primary on all platforms; fall back to the first.
            Monitor::all().ok()?.into_iter().next()
        })
        .ok_or_else(|| Error::Capture("no monitor available".into()))?;

    capture_monitor(&primary)
}

/// Capture a specific monitor by index (0-based). Useful when the user has multiple displays.
pub fn capture_by_index(index: usize) -> Result<CaptureResult> {
    let monitors = Monitor::all().map_err(|e| Error::Capture(format!("list monitors: {e}")))?;
    let monitor = monitors
        .get(index)
        .ok_or_else(|| Error::Capture(format!("monitor index {index} out of range")))?;
    capture_monitor(monitor)
}

fn capture_monitor(monitor: &Monitor) -> Result<CaptureResult> {
    let img = monitor
        .capture_image()
        .map_err(|e| Error::Capture(format!("capture failed: {e}")))?;

    let width = img.width();
    let height = img.height();

    // Downscale if absurdly wide — saves VLM cost and improves latency.
    // We keep the original if width <= 2400; otherwise scale to 2400 preserving aspect.
    let final_img: DynamicImage = if width > 2400 {
        let scaled = image::imageops::resize(
            &img,
            2400,
            (height as f32 * 2400.0 / width as f32).round() as u32,
            image::imageops::FilterType::Lanczos3,
        );
        DynamicImage::ImageRgba8(scaled)
    } else {
        DynamicImage::ImageRgba8(img)
    };

    let mut png_buf = Cursor::new(Vec::with_capacity(512 * 1024));
    final_img
        .write_to(&mut png_buf, ImageFormat::Png)
        .map_err(|e| Error::Image(format!("encode png: {e}")))?;

    let png = png_buf.into_inner();
    Ok(CaptureResult {
        png,
        width: final_img.width(),
        height: final_img.height(),
    })
}

/// Crop a captured image to the user's selection rectangle. Coordinates are in
/// device pixels relative to the captured image. Used when we want to send
/// just the selected region to the VLM (vs. the full screen).
pub fn crop_png(png_bytes: &[u8], x: u32, y: u32, w: u32, h: u32) -> Result<CaptureResult> {
    let img = image::load_from_memory_with_format(png_bytes, ImageFormat::Png)
        .map_err(|e| Error::Image(format!("decode png: {e}")))?;

    // Clamp to image bounds — the frontend may report selections slightly OOB
    // due to subpixel rounding on high-DPI displays.
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
