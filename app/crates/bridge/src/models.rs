//! Ollama model management. Runtime requests stay on loopback and never carry
//! collection content. API: https://github.com/ollama/ollama/blob/main/docs/api.md
use crate::{Bridge, CallError};
use anki_proto::generic;
use prost::Message;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
pub(crate) struct Models {
    job: Arc<Mutex<Value>>,
    cancel: Arc<AtomicBool>,
    mutation: Mutex<()>,
}
impl Drop for Models {
    fn drop(&mut self) { self.cancel.store(true, Ordering::Release); }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Preferences { endpoint: String, embedding: String, vision: String, match_sensitivity: f64 }
impl Default for Preferences {
    fn default() -> Self { Self { endpoint: "http://127.0.0.1:11434".into(), embedding: String::new(), vision: String::new(), match_sensitivity: 0.5 } }
}
fn error(message: impl ToString) -> CallError { CallError::Backend(message.to_string()) }
fn endpoint(value: &str) -> Result<String, CallError> {
    let mut url = reqwest::Url::parse(value.trim()).map_err(|_| error("Enter a local Ollama URL, for example http://127.0.0.1:11434."))?;
    if !matches!(url.scheme(), "http" | "https") || !matches!(url.host_str(), Some("127.0.0.1" | "[::1]" | "localhost"))
        || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() || url.path() != "/" {
        return Err(error("Ollama must use a loopback address without a path, credentials or query."));
    }
    if url.host_str() == Some("localhost") { url.set_host(Some("127.0.0.1")).map_err(error)?; }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}
fn model_name(value: &Value) -> Result<String, CallError> {
    let name = value.as_str().unwrap_or("").trim();
    if name.is_empty() || name.len() > 200 || !name.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-:/".contains(&c)) {
        return Err(error("Enter an Ollama model name."));
    }
    Ok(name.to_owned())
}
fn client() -> Result<reqwest::Client, CallError> {
    reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(3)).build().map_err(error)
}
async fn checked(response: reqwest::Response) -> Result<reqwest::Response, CallError> {
    if response.status().is_success() { return Ok(response); }
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    Err(error(body["error"].as_str().map(str::to_owned).unwrap_or_else(|| format!("Ollama returned {status}"))))
}
async fn installed(base: &str) -> Result<Vec<Value>, CallError> {
    let client = client()?;
    let reply = client.get(format!("{base}/api/tags")).timeout(Duration::from_secs(5)).send().await.map_err(error)?;
    let list: Value = checked(reply).await?.json().await.map_err(error)?;
    let models = list["models"].as_array().ok_or_else(|| error("Ollama returned an invalid model list."))?;
    let mut requests = tokio::task::JoinSet::new();
    for model in models {
        let client = client.clone(); let base = base.to_owned(); let model = model.clone();
        requests.spawn(async move {
            let name = model["name"].as_str().unwrap_or("");
            let details = match client.post(format!("{base}/api/show")).json(&json!({"model": name})).timeout(Duration::from_secs(5)).send().await {
                Ok(reply) => match checked(reply).await { Ok(reply) => reply.json::<Value>().await.ok(), Err(_) => None },
                Err(_) => None,
            };
            json!({"name":name,"size":model["size"],"runtime":"Ollama","capabilities":details.as_ref().and_then(|d| d.get("capabilities")).filter(|v|v.is_array()).cloned().unwrap_or(json!([])),"capabilitiesKnown":details.as_ref().is_some_and(|d| d["capabilities"].is_array())})
        });
    }
    let mut output = vec![];
    while let Some(result) = requests.join_next().await { output.push(result.map_err(error)?); }
    output.sort_by(|a,b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(output)
}
fn runtime<T>(future: impl std::future::Future<Output = Result<T, CallError>>) -> Result<T, CallError> {
    tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(error)?.block_on(future)
}
fn active(job: &Value) -> bool { matches!(job["state"].as_str(), Some("running" | "cancelling")) }
impl Bridge {
    pub(crate) fn models_call(&self, input: &[u8]) -> Result<Vec<u8>, CallError> {
        let request = generic::Json::decode(input).map_err(error)?;
        let request: Value = serde_json::from_slice(&request.json).map_err(error)?;
        let preferences = || serde_json::from_value::<Preferences>(self.profile("localModels")).unwrap_or_default();
        let prefs = preferences();
        let action = request["action"].as_str().unwrap_or("");
        let result = match action {
            "status" => json!({"preferences":prefs,"job":self.models.job.lock().unwrap().clone()}),
            "refresh" => {
                let base = endpoint(&prefs.endpoint)?;
                match runtime(installed(&base)) {
                    Ok(models) => json!({"online":true,"models":models}),
                    Err(CallError::Backend(message)) => json!({"online":false,"models":[],"error":message}),
                    Err(other) => return Err(other),
                }
            }
            "save" => {
                let _guard = self.models.mutation.lock().unwrap();
                let prefs = preferences();
                if active(&self.models.job.lock().unwrap()) { return Err(error("Wait for the download to finish or cancel it before changing model settings.")); }
                let mut next: Preferences = serde_json::from_value(request["preferences"].clone()).map_err(error)?;
                next.endpoint = endpoint(&next.endpoint)?;
                if !next.match_sensitivity.is_finite() || !(0.2..=0.8).contains(&next.match_sensitivity) { return Err(error("Match sensitivity must be between 20% and 80%.")); }
                // A changed runtime cannot inherit a selection from a different server.
                if next.endpoint != endpoint(&prefs.endpoint)? && (!next.embedding.is_empty() || !next.vision.is_empty()) { return Err(error("Clear model selections before changing the Ollama address.")); }
                if next.embedding != prefs.embedding || next.vision != prefs.vision {
                    let models = runtime(installed(&next.endpoint))?;
                    for (name, capability) in [(&next.embedding,"embedding"),(&next.vision,"vision")] {
                        if !name.is_empty() && !models.iter().any(|m| m["name"] == *name && m["capabilities"].as_array().is_some_and(|c| c.iter().any(|v| v == capability))) {
                            return Err(error(format!("{name} does not report the required {capability} capability.")));
                        }
                    }
                }
                self.set_setting("profile", "localModels", serde_json::to_value(&next).map_err(error)?)?;
                json!({"preferences":next})
            }
            "pull" => {
                let _guard = self.models.mutation.lock().unwrap();
                let prefs = preferences();
                let name = model_name(&request["model"])?;
                let base = endpoint(&prefs.endpoint)?;
                let mut job = self.models.job.lock().unwrap();
                if active(&job) { return Err(error("A model download is already in progress.")); }
                self.models.cancel.store(false, Ordering::Release);
                *job = json!({"state":"running","model":name,"status":"Connecting to Ollama","completed":0,"total":0});
                let state = self.models.job.clone(); let cancel = self.models.cancel.clone();
                std::thread::spawn(move || {
                    let result = runtime(async {
                        let cancel_wait = async { loop { if cancel.load(Ordering::Acquire) { break; } tokio::time::sleep(Duration::from_millis(50)).await; } };
                        tokio::select! {
                            result = pull(&base, &name, &state) => result,
                            _ = cancel_wait => Err(error("cancelled")),
                        }
                    });
                    let mut job = state.lock().unwrap();
                    match result {
                        Ok(()) => { job["state"] = json!("complete"); job["status"] = json!("Download complete"); }
                        Err(_) if cancel.load(Ordering::Acquire) => { job["state"] = json!("cancelled"); job["status"] = json!("Download cancelled. Ollama may keep partial files for a later retry."); }
                        Err(CallError::Backend(message)) => { job["state"] = json!("failed"); job["status"] = json!(message); }
                        Err(_) => { job["state"] = json!("failed"); job["status"] = json!("Download failed"); }
                    }
                });
                job.clone()
            }
            "cancel" => {
                let mut job = self.models.job.lock().unwrap();
                if active(&job) { self.models.cancel.store(true, Ordering::Release); job["state"] = json!("cancelling"); job["status"] = json!("Cancelling download…"); }
                job.clone()
            }
            "delete" => {
                let _guard = self.models.mutation.lock().unwrap();
                let mut prefs = preferences();
                if active(&self.models.job.lock().unwrap()) { return Err(error("Wait for the download to finish or cancel it before removing a model.")); }
                let name = model_name(&request["model"])?;
                if request["confirmed"] != true { return Err(error("Confirm model removal first.")); }
                let base = endpoint(&prefs.endpoint)?;
                runtime(async { let reply = client()?.delete(format!("{base}/api/delete")).json(&json!({"model":name})).timeout(Duration::from_secs(30)).send().await.map_err(error)?; checked(reply).await.map(|_| ()) })?;
                if prefs.embedding == name { prefs.embedding.clear(); }
                if prefs.vision == name { prefs.vision.clear(); }
                self.set_setting("profile", "localModels", serde_json::to_value(&prefs).map_err(error)?)?;
                json!({"preferences":prefs})
            }
            _ => return Err(error("Unknown model operation.")),
        };
        Ok(generic::Json { json: serde_json::to_vec(&result).map_err(error)? }.encode_to_vec())
    }
}
async fn pull(base: &str, name: &str, state: &Mutex<Value>) -> Result<(), CallError> {
    let mut response = checked(client()?.post(format!("{base}/api/pull")).json(&json!({"model":name,"stream":true})).send().await.map_err(error)?).await?;
    let mut pending = Vec::new();
    let mut success = false;
    while let Some(chunk) = response.chunk().await.map_err(error)? {
        pending.extend_from_slice(&chunk);
        if pending.len() > 1_048_576 { return Err(error("Ollama sent an oversized progress update.")); }
        while let Some(index) = pending.iter().position(|b| *b == b'\n') {
            let line = pending.drain(..=index).collect::<Vec<_>>();
            if line.iter().all(u8::is_ascii_whitespace) { continue; }
            success |= progress(&line, state)?;
        }
    }
    if !pending.is_empty() { success |= progress(&pending, state)?; }
    if success { Ok(()) } else { Err(error("Ollama ended the download without confirming success. Retry to resume.")) }
}
fn progress(line: &[u8], state: &Mutex<Value>) -> Result<bool, CallError> {
    let value: Value = serde_json::from_slice(line).map_err(error)?;
    if let Some(message) = value["error"].as_str() { return Err(error(message)); }
    let mut job = state.lock().unwrap();
    job["status"] = value["status"].clone();
    job["completed"] = json!(value["completed"].as_u64().unwrap_or(0));
    job["total"] = json!(value["total"].as_u64().unwrap_or(0));
    job["digest"] = value["digest"].clone();
    Ok(value["status"] == "success")
}
