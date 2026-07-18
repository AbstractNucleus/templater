use crate::error::{cmd_err, AppError};
use crate::store::Store;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

/// Call OpenRouter's chat completions endpoint to translate `text` to English.
/// API key and model come from on-disk settings — never from the webview IPC.
#[tauri::command]
pub async fn translate_text(
    text: String,
    store: tauri::State<'_, Store>,
) -> Result<String, String> {
    let (api_key, model) = store.translation_config().map_err(cmd_err)?;
    if api_key.is_empty() {
        return Err(cmd_err(AppError::msg(
            "OpenRouter API key not configured. Add it in Settings → Translation.",
        )));
    }

    let client = reqwest::Client::new();
    let request = ChatRequest {
        model,
        messages: vec![
            ChatMessage {
                role: "system".into(),
                content: "Translate the following text to English. Output only the translation, no explanations, no quotes, no commentary.".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: text,
            },
        ],
    };

    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| cmd_err(AppError::msg(format!("Network error: {e}"))))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(cmd_err(AppError::msg(format!(
            "OpenRouter error (HTTP {status}): {body}"
        ))));
    }

    let chat_response: ChatResponse = response
        .json()
        .await
        .map_err(|e| cmd_err(AppError::msg(format!("Failed to parse response: {e}"))))?;

    let translation = chat_response
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| cmd_err(AppError::msg("OpenRouter returned no choices")))?;
    if translation.trim().is_empty() {
        return Err(cmd_err(AppError::msg(
            "OpenRouter returned an empty translation",
        )));
    }

    Ok(translation)
}
