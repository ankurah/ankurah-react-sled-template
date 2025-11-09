use std::{panic, sync::Arc};

use ankurah::core::context::Context;
use ankurah::Node;
pub use ankurah_storage_indexeddb_wasm::IndexedDBStorageEngine;
use ankurah_template_model::{MyContextData, UserKeyPairAgent};
pub use ankurah_websocket_client_wasm::WebsocketClient;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ed25519_dalek::SigningKey;
use lazy_static::lazy_static;
use once_cell::sync::OnceCell;
use rand::rngs::OsRng;
use send_wrapper::SendWrapper;
use tracing::{error, info};
use wasm_bindgen::{prelude::wasm_bindgen, JsValue};
use web_sys::{window, Storage};

pub use ankurah_template_model::*;

// Re-export the new useObserve hook from ankurah-signals
pub use ankurah_signals::{react::*, JsValueMut, JsValueRead};

lazy_static! {
    static ref NODE: OnceCell<Node<IndexedDBStorageEngine, UserKeyPairAgent>> = OnceCell::new();
    static ref CLIENT: OnceCell<SendWrapper<WebsocketClient>> = OnceCell::new();
    static ref NOTIFY: tokio::sync::Notify = tokio::sync::Notify::new();
    static ref USER_KEYPAIR: OnceCell<SigningKey> = OnceCell::new();
    static ref CURRENT_USER: OnceCell<SendWrapper<ankurah_signals::JsValueMut>> = OnceCell::new();
}

const STORAGE_KEY_USER_ID: &str = "ankurah_template_user_id";
const STORAGE_KEY_PRIVATE_KEY: &str = "ankurah_template_private_key";

#[wasm_bindgen(start)]
pub async fn start() -> Result<(), JsValue> {
    // Configure tracing_wasm to filter out DEBUG logs
    tracing_wasm::set_as_global_default_with_config(
        tracing_wasm::WASMLayerConfigBuilder::new()
            .set_max_level(tracing::Level::INFO) // Only show INFO, WARN, ERROR
            .build(),
    );
    panic::set_hook(Box::new(console_error_panic_hook::hook));

    // Load or generate user keypair
    let user_keypair = load_or_generate_user_keypair()?;
    if let Err(_) = USER_KEYPAIR.set(user_keypair.clone()) {
        error!("Failed to set user keypair");
    }

    let storage_engine = IndexedDBStorageEngine::open("ankurah_template_app")
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let node = Node::new(
        Arc::new(storage_engine),
        UserKeyPairAgent::new_client(user_keypair),
    );

    // Build WebSocket URL based on current window location
    let window = window().ok_or_else(|| JsValue::from_str("No window available"))?;
    let location = window.location();
    let hostname = location
        .hostname()
        .map_err(|e| JsValue::from_str(&format!("Failed to get hostname: {:?}", e)))?;
    let ws_url = format!("ws://{}:9797", hostname);

    let connector = WebsocketClient::new(node.clone(), &ws_url)?;
    node.system.wait_system_ready().await;
    if let Err(_) = NODE.set(node) {
        error!("Failed to set node");
    }
    if let Err(_) = CLIENT.set(SendWrapper::new(connector)) {
        error!("Failed to set connector");
    }

    // Initialize current user signal
    let initial_value = JsValue::NULL;
    let user_signal = ankurah_signals::JsValueMut::new(initial_value);
    if let Err(_) = CURRENT_USER.set(SendWrapper::new(user_signal)) {
        error!("Failed to set current user signal");
    }

    // Initialize user (blocking) before notifying that system is ready
    match init_user_internal().await {
        Ok(user_view) => {
            if let Some(user_signal) = CURRENT_USER.get() {
                user_signal.set(JsValue::from(user_view));
            }
        }
        Err(e) => {
            error!("Failed to initialize user: {:?}", e);
            return Err(e);
        }
    }

    // Now notify that initialization is complete
    NOTIFY.notify_waiters();

    Ok(())
}

pub fn get_node() -> Node<IndexedDBStorageEngine, UserKeyPairAgent> {
    NODE.get().expect("Node not initialized").clone()
}

fn get_local_storage() -> Result<Storage, JsValue> {
    let window = window().ok_or_else(|| JsValue::from_str("No window available"))?;
    window
        .local_storage()
        .map_err(|e| JsValue::from_str(&format!("Failed to get localStorage: {:?}", e)))?
        .ok_or_else(|| JsValue::from_str("localStorage not available"))
}

fn load_or_generate_user_keypair() -> Result<SigningKey, JsValue> {
    let storage = get_local_storage()?;

    // Try to load existing key
    if let Some(key_b64) = storage
        .get_item(STORAGE_KEY_PRIVATE_KEY)
        .map_err(|e| JsValue::from_str(&format!("Failed to read private key: {:?}", e)))?
    {
        let key_bytes = BASE64
            .decode(&key_b64)
            .map_err(|e| JsValue::from_str(&format!("Failed to decode private key: {}", e)))?;
        let key_array: [u8; 32] = key_bytes
            .try_into()
            .map_err(|_| JsValue::from_str("Invalid private key length"))?;
        return Ok(SigningKey::from_bytes(&key_array));
    }

    // Generate new keypair
    let user_keypair = SigningKey::generate(&mut OsRng);
    let key_b64 = BASE64.encode(user_keypair.to_bytes());
    storage
        .set_item(STORAGE_KEY_PRIVATE_KEY, &key_b64)
        .map_err(|e| JsValue::from_str(&format!("Failed to store private key: {:?}", e)))?;

    Ok(user_keypair)
}

#[wasm_bindgen]
pub fn ctx() -> Result<Context, JsValue> {
    let storage = get_local_storage()?;
    let user_id_b64 = storage
        .get_item(STORAGE_KEY_USER_ID)
        .map_err(|e| JsValue::from_str(&format!("Failed to read user ID: {:?}", e)))?
        .ok_or_else(|| JsValue::from_str("User not initialized - call ensure_user first"))?;

    let user_id = ankurah::proto::EntityId::from_base64(&user_id_b64)
        .map_err(|e| JsValue::from_str(&format!("Invalid user ID: {}", e)))?;

    get_node()
        .context(MyContextData::User(user_id))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn ws_client() -> WebsocketClient {
    (**CLIENT.get().expect("Client not initialized")).clone()
}

#[wasm_bindgen]
pub async fn ready() -> Result<(), JsValue> {
    match CLIENT.get() {
        Some(client) => client.ready().await,
        None => {
            NOTIFY.notified().await;
            CLIENT.get().expect("Client not initialized").ready().await
        }
    }
    .map_err(|_| JsValue::from_str("Failed to connect to server"))
}

#[wasm_bindgen]
pub fn current_user() -> JsValueRead {
    CURRENT_USER
        .get()
        .map(|user_signal| user_signal.read())
        .expect("Current user not initialized")
}

async fn init_user_internal() -> Result<UserView, JsValue> {
    let storage = get_local_storage()?;
    let node = get_node();
    let user_keypair = USER_KEYPAIR
        .get()
        .ok_or_else(|| JsValue::from_str("User keypair not initialized"))?;

    // Check if user already exists
    if let Some(user_id_b64) = storage
        .get_item(STORAGE_KEY_USER_ID)
        .map_err(|e| JsValue::from_str(&format!("Failed to read user ID: {:?}", e)))?
    {
        let user_id = ankurah::proto::EntityId::from_base64(&user_id_b64)
            .map_err(|e| JsValue::from_str(&format!("Invalid user ID: {}", e)))?;

        let context = node
            .context(MyContextData::User(user_id))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let user = context
            .get::<UserView>(user_id)
            .await
            .map_err(|e| JsValue::from_str(&format!("Failed to fetch user: {}", e)))?;

        return Ok(user);
    }

    // Create new user
    let verifying_key = user_keypair.verifying_key();
    let pub_key = BASE64.encode(verifying_key.to_bytes());
    info!("Creating new user with public key: {}", pub_key);

    // We need to create a temporary context for user creation
    // Use Anonymous context for self-registration since we don't have a user yet
    let temp_context = node
        .context(MyContextData::Anonymous)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let transaction = temp_context.begin();
    let user_mut = transaction
        .create(&User {
            display_name: format!(
                "User-{}",
                (web_sys::js_sys::Math::random() * 10000.0) as i32
            ),
            pub_key: String::new(), // Initialize empty, will set below
        })
        .await
        .map_err(|e| JsValue::from_str(&format!("Failed to create user: {}", e)))?;
    let user_id = user_mut.id();
    info!("Created user with ID: {}", user_id.to_base64());

    // Set the LWW pub_key field explicitly
    user_mut
        .pub_key()
        .set(&pub_key)
        .map_err(|e| JsValue::from_str(&format!("Failed to set public key: {}", e)))?;
    info!("Set public key for user {}", user_id.to_base64());

    info!("About to commit user creation transaction");
    transaction.commit().await.map_err(|e| {
        error!("Failed to commit user creation transaction: {:?}", e);
        JsValue::from_str(&format!("Failed to commit transaction: {}", e))
    })?;
    info!("Successfully committed user creation transaction");

    // Store user ID
    storage
        .set_item(STORAGE_KEY_USER_ID, &user_id.to_base64())
        .map_err(|e| JsValue::from_str(&format!("Failed to store user ID: {:?}", e)))?;

    // Get the view for the newly created user
    let user_context = node
        .context(MyContextData::User(user_id))
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let user_view = user_context
        .get::<UserView>(user_id)
        .await
        .map_err(|e| JsValue::from_str(&format!("Failed to fetch created user: {}", e)))?;

    Ok(user_view)
}

// Just export the models and basic primitives
// All business logic should be in the React app
