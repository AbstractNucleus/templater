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
/// `api_key` is the user's OpenRouter API key; `model` is the model identifier
/// (e.g. "openrouter/free").
#[tauri::command]
pub async fn translate_text(text: String, api_key: String, model: String) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("OpenRouter API key not configured. Add it in Settings → Translation.".into());
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
        .map_err(|e| format!("Network error: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("OpenRouter error (HTTP {status}): {body}"));
    }

    let chat_response: ChatResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    let translation = chat_response
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .unwrap_or_default();

    Ok(translation)
}
