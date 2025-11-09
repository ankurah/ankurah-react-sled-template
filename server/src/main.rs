use ankurah::Node;
use ankurah_storage_sled::SledStorageEngine;
use ankurah_template_model::{MyContextData, Room, RoomView, UserKeyPairAgent};
use ankurah_websocket_server::WebsocketServer;
use anyhow::Result;
use std::sync::Arc;
use tracing::{info, Level};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_max_level(Level::INFO).init(); // initialize tracing

    // Initialize storage engine
    let storage = SledStorageEngine::with_homedir_folder(".ankurah-template")?;
    
    // Create agent and node
    let agent = UserKeyPairAgent::new_server();
    let node = Node::new_durable(Arc::new(storage), agent.clone());
    
    // Initialize agent's root context now that node exists
    agent.initialize_root_context(node.clone());

    node.system.wait_loaded().await;
    if node.system.root().is_none() {
        node.system.create().await?;
    }

    // Ensure "General" room exists
    ensure_general_room(&node).await?;

    let mut server = WebsocketServer::new(node);
    server.run("0.0.0.0:9797").await?;

    Ok(())
}

async fn ensure_general_room(node: &Node<SledStorageEngine, UserKeyPairAgent>) -> Result<()> {
    let context = node.context_async(MyContextData::Root).await;

    // Query for a room named "General"
    let rooms = context.fetch::<RoomView>("name = 'General'").await?;

    if rooms.is_empty() {
        info!("Creating 'General' room");

        let trx = context.begin();
        trx.create(&Room {
            name: "General".to_string(),
        })
        .await?;
        trx.commit().await?;

        info!("'General' room created");
    } else {
        info!("'General' room already exists");
    }

    Ok(())
}
