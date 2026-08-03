//! Vision-Language Model client. Supports GLM-4.6V (primary), GPT-4o (fallback),
//! and Gemini 2.0 Flash (eval comparison). All providers speak an OpenAI-compatible
//! request shape; only auth header and URL differ (Gemini is adapted).
//!
//! SECURITY: API keys are read from the Tauri Store (encrypted on disk by the OS)
//! or environment variables, never embedded in the binary and never sent to the
//! frontend. The frontend calls the `recognize` command; the Rust side performs
//! the HTTP call.

use crate::error::{Error, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    /// GLM-4.6V (full, paid) or GLM-4.6V-Flash (free).
    Glm,
    /// GPT-4o / GPT-4o-mini — OpenAI fallback.
    Openai,
    /// Gemini 2.0 Flash — eval comparison.
    Gemini,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecognizeRequest {
    pub provider: Provider,
    /// Model name within the provider, e.g. "glm-4.6v", "glm-4.6v-flash", "gpt-4o", "gemini-2.0-flash".
    pub model: String,
    /// PNG bytes (raw, will be base64-encoded).
    pub image_png: Vec<u8>,
    /// Prompt (the OCR instruction). See `prompts/ocr.md`.
    pub prompt: String,
    /// Enable GLM-4.6V deep-thinking mode for complex layouts (tables, formulas).
    /// Ignored by other providers.
    #[serde(default)]
    pub thinking: bool,
    /// Soft temperature — low for OCR. Most providers accept 0–2.
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    /// Max output tokens. Markdown of a screenshot rarely exceeds 4k.
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
}

fn default_temperature() -> f32 {
    0.1
}
fn default_max_tokens() -> u32 {
    4096
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecognizeResponse {
    pub text: String,
    pub usage: Usage,
    pub model: String,
    /// Latency in milliseconds.
    pub latency_ms: u64,
    /// Estimated cost in CNY (only GLM priced in CNY; USD converted at 7.2 for the others).
    pub cost_cny: f64,
    /// Provider echoed back.
    pub provider: Provider,
}

impl RecognizeRequest {
    fn image_data_url(&self) -> String {
        let b64 = base64::engine::general_purpose::STANDARD.encode(&self.image_png);
        format!("data:image/png;base64,{b64}")
    }
}

/// Resolve an API key — prefer user-configured (Store), fall back to env.
fn resolve_key(app: &AppHandle, store_key: &str, env_key: &str) -> Result<String> {
    if let Ok(store) = app.store("settings.json") {
        if let Some(v) = store.get(store_key) {
            if let Some(s) = v.as_str() {
                if !s.is_empty() {
                    return Ok(s.to_string());
                }
            }
        }
    }
    if let Ok(v) = std::env::var(env_key) {
        if !v.is_empty() {
            return Ok(v);
        }
    }
    Err(Error::Config(format!(
        "missing API key: set it in Settings or env var {env_key}"
    )))
}

/// Main entrypoint invoked by the `recognize` Tauri command.
pub async fn recognize(app: &AppHandle, mut req: RecognizeRequest) -> Result<RecognizeResponse> {
    let started = std::time::Instant::now();

    // GLM-Flash default — cheap path. If user picked GLM but no model, default to Flash.
    if matches!(req.provider, Provider::Glm) && req.model.is_empty() {
        req.model = "glm-4.6v-flash".into();
    }
    if matches!(req.provider, Provider::Openai) && req.model.is_empty() {
        req.model = "gpt-4o".into();
    }
    if matches!(req.provider, Provider::Gemini) && req.model.is_empty() {
        req.model = "gemini-2.0-flash".into();
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| Error::Vlm(format!("build http client: {e}")))?;

    let (text, usage) = match req.provider {
        Provider::Glm => call_openai_compatible(
            &client,
            &req,
            "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            &resolve_key(app, "glm_api_key", "GLM_API_KEY")?,
            // GLM supports a `thinking` field on the request root for deep-thinking mode.
            Some(serde_json::json!({ "thinking": req.thinking })),
        )
        .await?,
        Provider::Openai => call_openai_compatible(
            &client,
            &req,
            "https://api.openai.com/v1/chat/completions",
            &resolve_key(app, "openai_api_key", "OPENAI_API_KEY")?,
            None,
        )
        .await?,
        Provider::Gemini => {
            let key = resolve_key(app, "gemini_api_key", "GEMINI_API_KEY")?;
            call_gemini(&client, &req, &key).await?
        }
    };

    let latency_ms = started.elapsed().as_millis() as u64;
    let cost_cny = estimate_cost_cny(&req.provider, &req.model, &usage);

    Ok(RecognizeResponse {
        text,
        usage,
        model: req.model,
        latency_ms,
        cost_cny,
        provider: req.provider,
    })
}

/// OpenAI-compatible chat completions call. GLM and OpenAI share this shape.
async fn call_openai_compatible(
    client: &reqwest::Client,
    req: &RecognizeRequest,
    url: &str,
    api_key: &str,
    extra_root: Option<serde_json::Value>,
) -> Result<(String, Usage)> {
    let mut body = serde_json::json!({
        "model": req.model,
        "messages": [
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": req.prompt },
                    { "type": "image_url", "image_url": { "url": req.image_data_url() } }
                ]
            }
        ],
        "temperature": req.temperature,
        "max_tokens": req.max_tokens,
        "stream": false,
    });
    if let Some(extra) = extra_root {
        if let serde_json::Value::Object(map) = &mut body {
            if let serde_json::Value::Object(extra_map) = extra {
                for (k, v) in extra_map {
                    map.insert(k.clone(), v.clone());
                }
            }
        }
    }

    let resp = client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| Error::Vlm(format!("request: {e}")))?;

    let status = resp.status();
    let raw = resp
        .text()
        .await
        .map_err(|e| Error::Vlm(format!("read body: {e}")))?;

    if !status.is_success() {
        return Err(Error::Upstream {
            status: status.as_u16(),
            body: raw,
        });
    }

    let parsed: ChatCompletionResponse = serde_json::from_str(&raw)
        .map_err(|e| Error::Vlm(format!("parse response: {e}; body: {raw}")))?;

    let text = parsed
        .choices
        .first()
        .and_then(|c| Some(c.message.content.as_str()))
        .ok_or_else(|| Error::Vlm("empty choices in response".into()))?
        .to_string();

    let usage = parsed.usage.unwrap_or(Usage {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
    });

    Ok((strip_code_fences(text), usage))
}

/// Gemini has its own API shape — adapt here. We use the v1beta generateContent endpoint.
async fn call_gemini(
    client: &reqwest::Client,
    req: &RecognizeRequest,
    api_key: &str,
) -> Result<(String, Usage)> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        req.model, api_key
    );

    let body = serde_json::json!({
        "contents": [{
            "parts": [
                { "text": req.prompt },
                { "inline_data": { "mime_type": "image/png", "data": req.image_data_url() } }
            ]
        }],
        "generationConfig": {
            "temperature": req.temperature,
            "maxOutputTokens": req.max_tokens,
        }
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| Error::Vlm(format!("gemini request: {e}")))?;

    let status = resp.status();
    let raw = resp
        .text()
        .await
        .map_err(|e| Error::Vlm(format!("gemini read body: {e}")))?;
    if !status.is_success() {
        return Err(Error::Upstream {
            status: status.as_u16(),
            body: raw,
        });
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| Error::Vlm(format!("gemini parse: {e}")))?;

    let text = parsed["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or_else(|| Error::Vlm("gemini: no text in response".into()))?
        .to_string();

    let usage = Usage {
        prompt_tokens: parsed["usageMetadata"]["promptTokenCount"]
            .as_u64()
            .unwrap_or(0),
        completion_tokens: parsed["usageMetadata"]["candidatesTokenCount"]
            .as_u64()
            .unwrap_or(0),
        total_tokens: parsed["usageMetadata"]["totalTokenCount"]
            .as_u64()
            .unwrap_or(0),
    };

    Ok((strip_code_fences(text), usage))
}

/// VLMs occasionally wrap their output in ```...``` despite the prompt forbidding it.
/// Strip a single outer fence if the entire output is fenced.
fn strip_code_fences(mut s: String) -> String {
    let trimmed = s.trim();
    if let Some(rest) = trimmed.strip_prefix("```") {
        if let Some(end) = rest.rfind("```") {
            // Find end-of-first-line (skip optional language tag like ```markdown).
            let after_first_newline = rest.find('\n').unwrap_or(rest.len());
            let _lang_tag = &rest[..after_first_newline.min(end)];
            let inner_start = after_first_newline.min(end + 1);
            let inner = &rest[inner_start..end];
            return inner.trim_start_matches('\n').trim_end().to_string();
        }
    }
    s = trimmed.to_string();
    s
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Debug, Deserialize)]
struct Message {
    content: String,
}

/// Rough cost estimation per provider. Prices as of 2026-08.
/// GLM-4.6V: ¥1 / M input, ¥3 / M output.
/// GLM-4.6V-Flash: free.
/// GPT-4o: $2.5 / M input, $10 / M output → ¥18 / ¥72 (at 7.2 CNY/USD).
/// Gemini 2.0 Flash: $0.1 / M input, $0.4 / M output.
fn estimate_cost_cny(provider: &Provider, model: &str, usage: &Usage) -> f64 {
    let in_t = usage.prompt_tokens as f64 / 1_000_000.0;
    let out_t = usage.completion_tokens as f64 / 1_000_000.0;
    match provider {
        Provider::Glm => {
            if model.contains("flash") {
                0.0
            } else {
                in_t * 1.0 + out_t * 3.0
            }
        }
        Provider::Openai => {
            let in_per_m = if model.contains("mini") { 0.15 } else { 2.5 };
            let out_per_m = if model.contains("mini") { 0.6 } else { 10.0 };
            (in_t * in_per_m + out_t * out_per_m) * 7.2
        }
        Provider::Gemini => (in_t * 0.1 + out_t * 0.4) * 7.2,
    }
}

/// Read the prompt from the bundled asset. The frontend passes it in for now,
/// but this helper is here in case we want to version-pin in the binary later.
#[allow(dead_code)]
pub fn default_prompt() -> String {
    include_str!("../prompts/ocr.md").to_string()
}
