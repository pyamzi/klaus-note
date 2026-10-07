//! Model management uses a fake Ollama server. Never downloads or removes a
//! user's real models; preferences and collection both live in a temp directory.
use anki_proto::generic;
use klaus_bridge::Bridge;
use prost::Message;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::time::{Duration, Instant};

struct Ollama { address: String, calls: Arc<Mutex<Vec<(String, Value)>>>, stop: Arc<AtomicBool>, thread: Option<std::thread::JoinHandle<()>> }
impl Ollama {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let stop = Arc::new(AtomicBool::new(false));
        let calls = Arc::new(Mutex::new(vec![]));
        let (thread_stop, thread_calls) = (stop.clone(), calls.clone());
        let thread = std::thread::spawn(move || {
            for socket in listener.incoming() {
                if thread_stop.load(Ordering::Acquire) { break; }
                let calls = thread_calls.clone();
                std::thread::spawn(move || {
                    let mut socket = socket.unwrap();
                    socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                    let mut data = vec![];
                    let mut buffer = [0; 4096];
                    let header_end = loop {
                        let n = socket.read(&mut buffer).unwrap_or(0); if n == 0 { return; }
                        data.extend_from_slice(&buffer[..n]);
                        if let Some(index) = data.windows(4).position(|w| w == b"\r\n\r\n") { break index + 4; }
                    };
                    let headers = String::from_utf8_lossy(&data[..header_end]);
                    let route = headers.lines().next().unwrap().split_whitespace().take(2).collect::<Vec<_>>().join(" ");
                    let length = headers.lines().find_map(|line| line.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                    while data.len() < header_end + length {
                        let n = socket.read(&mut buffer).unwrap_or(0); if n == 0 { return; } data.extend_from_slice(&buffer[..n]);
                    }
                    let body: Value = serde_json::from_slice(&data[header_end..]).unwrap_or(Value::Null);
                    calls.lock().unwrap().push((route.clone(), body.clone()));
                    if route == "POST /api/pull" {
                        let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n");
                        let first = b"{\"status\":\"pulling layer\",\"digest\":\"x\",\"completed\":25,\"total\":100}\n";
                        let write_chunk = |socket: &mut TcpStream, chunk: &[u8]| -> std::io::Result<()> { write!(socket, "{:x}\r\n", chunk.len())?; socket.write_all(chunk)?; socket.write_all(b"\r\n") };
                        let _ = write_chunk(&mut socket, &first[..15]);
                        let _ = write_chunk(&mut socket, &first[15..]);
                        if body["model"] == "slow" { std::thread::sleep(Duration::from_secs(2)); }
                        let last: &[u8] = if body["model"] == "broken" { b"{\"error\":\"model not found\"}\n" } else if body["model"] == "truncated" { b"{\"status\":\"verifying\"}\n" } else { b"{\"status\":\"success\"}" };
                        let _ = write_chunk(&mut socket, last);
                        let _ = socket.write_all(b"0\r\n\r\n");
                        return;
                    }
                    let response = match route.as_str() {
                        "GET /api/tags" => json!({"models":[{"name":"embed:latest","size":1234},{"name":"vision:latest","size":5678},{"name":"unknown:latest","size":9}]}),
                        "POST /api/show" if body["model"] == "embed:latest" => json!({"capabilities":["embedding"]}),
                        "POST /api/show" if body["model"] == "vision:latest" => json!({"capabilities":["completion","vision"]}),
                        "POST /api/show" => json!({}),
                        "DELETE /api/delete" => json!({}),
                        _ => panic!("unexpected request {route}"),
                    }.to_string();
                    let _ = write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response);
                });
            }
        });
        Self { address:format!("http://{address}"), calls, stop, thread:Some(thread) }
    }
}
impl Drop for Ollama {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = TcpStream::connect(self.address.trim_start_matches("http://"));
        self.thread.take().unwrap().join().unwrap();
    }
}
fn call(bridge: &Bridge, request: Value) -> Result<Value, String> {
    let bytes = bridge.call("klausModels", &generic::Json { json: serde_json::to_vec(&request).unwrap() }.encode_to_vec()).map_err(|e| format!("{e:?}"))?;
    Ok(serde_json::from_slice(&generic::Json::decode(bytes.as_slice()).unwrap().json).unwrap())
}
fn setup() -> (tempfile::TempDir, Bridge, Ollama) {
    let dir = tempfile::tempdir().unwrap(); let bridge = Bridge::new().unwrap(); bridge.open_collection(dir.path()).unwrap(); let server = Ollama::start();
    call(&bridge, json!({"action":"save","preferences":{"endpoint":server.address,"embedding":"","vision":"","matchSensitivity":0.5}})).unwrap();
    (dir, bridge, server)
}
fn wait_job(bridge: &Bridge, wanted: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let job = call(bridge,json!({"action":"status"})).unwrap()["job"].clone();
        if job["state"] == wanted { return job; }
        assert!(Instant::now() < deadline, "expected {wanted}, got {job}");
        std::thread::sleep(Duration::from_millis(20));
    }
}
#[test]
fn models_capabilities_selection_validation_and_persistence() {
    let (dir, bridge, server) = setup();
    let data = call(&bridge, json!({"action":"refresh"})).unwrap();
    assert_eq!(data["online"], true);
    assert_eq!(data["models"][0]["capabilities"], json!(["embedding"]));
    assert_eq!(data["models"][1]["capabilitiesKnown"], false);
    assert_eq!(data["models"][2]["capabilities"], json!(["completion","vision"]));
    let prefs = json!({"endpoint":server.address,"embedding":"embed:latest","vision":"vision:latest","matchSensitivity":0.65});
    call(&bridge,json!({"action":"save","preferences":prefs})).unwrap();
    let mut invalid = prefs.clone(); invalid["embedding"] = json!("vision:latest");
    assert!(call(&bridge,json!({"action":"save","preferences":invalid})).unwrap_err().contains("required embedding capability"));
    assert_eq!(call(&bridge,json!({"action":"status"})).unwrap()["preferences"], prefs);
    bridge.close_collection().unwrap(); drop(bridge);
    let bridge = Bridge::new().unwrap(); bridge.open_collection(dir.path()).unwrap();
    assert_eq!(call(&bridge,json!({"action":"status"})).unwrap()["preferences"], prefs);
    assert!(call(&bridge,json!({"action":"delete","model":"embed:latest"})).is_err());
    assert!(!server.calls.lock().unwrap().iter().any(|(route,_)| route == "DELETE /api/delete"));
    call(&bridge,json!({"action":"delete","model":"embed:latest","confirmed":true})).unwrap();
    assert_eq!(call(&bridge,json!({"action":"status"})).unwrap()["preferences"]["embedding"], "");
    assert_eq!(call(&bridge,json!({"action":"status"})).unwrap()["preferences"]["vision"], "vision:latest");
}
#[test]
fn models_stream_progress_cancel_retry_and_errors() {
    let (_dir, bridge, _server) = setup();
    call(&bridge,json!({"action":"pull","model":"slow"})).unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        let job = call(&bridge,json!({"action":"status"})).unwrap()["job"].clone();
        if job["completed"] == 25 { assert_eq!(job["total"],100); break; }
        assert!(Instant::now() < deadline); std::thread::sleep(Duration::from_millis(20));
    }
    assert!(call(&bridge,json!({"action":"pull","model":"second"})).is_err());
    assert!(call(&bridge,json!({"action":"save","preferences":{"endpoint":"http://127.0.0.1:11434"}})).is_err());
    assert!(call(&bridge,json!({"action":"delete","model":"embed:latest","confirmed":true})).is_err());
    call(&bridge,json!({"action":"cancel"})).unwrap();
    wait_job(&bridge,"cancelled");
    call(&bridge,json!({"action":"pull","model":"good"})).unwrap();
    wait_job(&bridge,"complete");
    call(&bridge,json!({"action":"pull","model":"broken"})).unwrap();
    assert_eq!(wait_job(&bridge,"failed")["status"], "model not found");
    call(&bridge,json!({"action":"pull","model":"truncated"})).unwrap();
    assert!(wait_job(&bridge,"failed")["status"].as_str().unwrap().contains("without confirming success"));
}
#[test]
fn models_reject_nonlocal_endpoints_and_invalid_settings() {
    let (_dir, bridge, server) = setup();
    for address in ["https://example.com", "http://127.0.0.1:11434/private", "http://user:pass@127.0.0.1", "file:///etc/passwd", "http://localhost:11434/?token=x"] {
        assert!(call(&bridge,json!({"action":"save","preferences":{"endpoint":address}})).is_err());
    }
    assert!(call(&bridge,json!({"action":"save","preferences":{"endpoint":server.address,"matchSensitivity":0.9}})).is_err());
    assert!(call(&bridge,json!({"action":"pull","model":"bad\nname"})).is_err());
    assert!(call(&bridge,json!({"action":"invented"})).is_err());
    assert!(server.calls.lock().unwrap().is_empty());
}

#[test]
fn models_runtime_offline_is_reported_without_losing_preferences() {
    let (_dir, bridge, server) = setup();
    let preferences = call(&bridge,json!({"action":"status"})).unwrap()["preferences"].clone();
    drop(server);
    let response = call(&bridge,json!({"action":"refresh"})).unwrap();
    assert_eq!(response["online"],false);
    assert_eq!(response["models"],json!([]));
    assert!(!response["error"].as_str().unwrap().is_empty());
    assert_eq!(call(&bridge,json!({"action":"status"})).unwrap()["preferences"],preferences);
}
