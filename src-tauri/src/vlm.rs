//! Vision-Language Model client - simplified version for CI testing.
//!
//! Supports GLM-4.6V (primary), GPT-4o (fallback), and Gemini 2.0 Flash.

use crate::error::{Error, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Manager};

// Standard HTTP client instead of Tauri plugin
use reqwest::blocking::Client;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Glm,
    Openai,
    Gemini,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecognizeRequest {
    pub provider: Provider,
    pub model: String,
    pub image_png: Vec<u8>,
    pub prompt: String,
    #[serde(default)]
    pub thinking: bool,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
}

fn default_temperature() -> f32 { 0.1 }
fn default_max_tokens() -> u32 { 4096 }

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
    pub latency_ms: u64,
    pub cost_cny: f64,
    pub provider: Provider,
}

/// Main entrypoint - VLM HTTP calls with API key from environment.
pub async fn recognize(app: &AppHandle, mut req: RecognizeRequest) -> Result<RecognizeResponse> {
    let started = std::time::Instant::now();

    // Default models
    if req.model.is_empty() {
        req.model = match req.provider {
            Provider::Glm => "glm-4.6v-flash".to_string(),
            Provider::Openai => "gpt-4o".to_string(),
            Provider::Gemini => "gemini-2.0-flash".to_string(),
        };
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| Error::Other(anyhow::anyhow!("build http client: {e}")))?;

    let (text, usage) = match req.provider {
        Provider::Glm => {
            let api_key = std::env::var("GLM_API_KEY")
                .map_err(|_| Error::Config("missing GLM_API_KEY env var".into()))?;
            call_openai_compatible(&client, &req, "https://open.bigmodel.cn/api/paas/v4/chat/completions", &api_key, None).await?
        }
        Provider::Openai => {
            let api_key = std::env::var("OPENAI_API_KEY")
                .map_err(|_| Error::Config("missing OPENAI_API_KEY env var".into()))?;
            call_openai_compatible(&client, &req, "https://api.openai.com/v1/chat/completions", &api_key, None).await?
        }
        Provider::Gemini => {
            let api_key = std::env::var("GEMINI_API_KEY")
                .map_err(|_| Error::Config("missing GEMINI_API_KEY env var".into()))?;
            call_gemini(&client, &req, &api_key).await?
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

/// OpenAI-compatible chat completions call.
async fn call_openai_compatible(
    client: &Client,
    req: &RecognizeRequest,
    url: &str,
    api_key: &str,
    _extra_root: Option<serde_json::Value>,
) -> Result<(String, Usage)> {
    let body = serde_json::json!({
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

    let resp = client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|e| Error::Other(anyhow::anyhow!("request: {e}")))?;

    let status = resp.status();
    let raw = resp
        .text()
        .await
        .map_err(|e| Error::Other(anyhow::anyhow!("read body: {e}")))?;

    if !status.is_success() {
        return Err(Error::Upstream {
            status: status.as_u16(),
            body: raw,
        });
    }

    let parsed: ChatCompletionResponse = serde_json::from_str(&raw)
        .map_err(|e| Error::Other(anyhow::anyhow!("parse response: {e}; body: {raw}")))?;

    let text = parsed
        .choices
        .first()
        .and_then(|c| Some(c.message.content.as_str()))
        .ok_or_else(|| Error::Other(anyhow::anyhow!("empty choices in response".into())))?
        .to_string();

    let usage = parsed.usage.unwrap_or(Usage {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
    });

    Ok((strip_code_fences(text), usage))
}

/// Gemini API call.
async fn call_gemini(
    client: &Client,
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
                { "inline_data": { "mime_type": "image/png", "data": req.image_data_url().split(',').nth(1).unwrap_or(&[]) } }
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
        .map_err(|e| Error::Other(anyhow::anyhow!("gemini request: {e}")))?;

    let status = resp.status();
    let raw = resp
        .text()
        .await
        .map_err(|e| Error::Other(anyhow::anyhow!("gemini read body: {e}")))?;
    if !status.is_success() {
        return Err(Error::Upstream {
            status: status.as_u16(),
            body: raw,
        });
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| Error::Other(anyhow::anyhow!("gemini parse: {e}")))?;

    let text = parsed["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or_else(|| Error::Other(anyhow::anyhow!("gemini: no text in response".into())))?
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

fn strip_code_fences(mut s: String) -> String {
    let trimmed = s.trim();
    if let Some(rest) = trimmed.strip_prefix("```") {
        if let Some(end) = rest.rfind("```") {
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

/// Rough cost estimation per provider.
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

pub fn default_prompt() -> String {
    include_str!("../prompts/ocr.md").to_string()
}
