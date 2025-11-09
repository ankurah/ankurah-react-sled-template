use ankurah::Model;
use serde::{Deserialize, Serialize};

#[derive(Model, Debug, Serialize, Deserialize)]
pub struct User {
    pub display_name: String,
    #[active_type(LWW)]
    pub pub_key: String, // Base64-encoded public key
}

// Room model - chat rooms
#[derive(Model, Debug, Serialize, Deserialize)]
pub struct Room {
    pub name: String,
}

#[derive(Model, Debug, Serialize, Deserialize)]
pub struct Message {
    #[active_type(LWW)]
    pub user: String,
    #[active_type(LWW)]
    pub room: String,
    pub text: String,
    pub timestamp: i64,
    #[active_type(LWW)]
    pub deleted: bool,
}

// PolicyAgent implementation - must come AFTER models so UserView is available
mod policy_impl {
    use super::*;
    use ankurah::{
        core::{
            context::Context,
            entity::Entity,
            error::ValidationError,
            node::{ContextData as ContextDataTrait, Node, NodeInner},
            policy::{AccessDenied, PolicyAgent},
            reactor::AbstractEntity,
            storage::StorageEngine,
            util::Iterable,
            value::Value,
        },
        proto::{self, Attested},
    };
    use async_trait::async_trait;
    use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
    use once_cell::sync::OnceCell;
    use std::hash::Hash;
    use std::sync::Arc;
    use tracing::info;

    /// ContextData for UserKeyPairAgent
    #[derive(Debug, Clone, PartialEq, Eq, Hash)]
    pub enum MyContextData {
        /// Authenticated user by EntityId
        User(proto::EntityId),
        /// System/root context - only constructable locally, never from AuthData
        Root,
        /// Anonymous/unauthenticated context - for user self-registration
        Anonymous,
    }

    #[async_trait]
    impl ContextDataTrait for MyContextData {}

    /// PolicyAgent that uses Ed25519 keypairs for request signing
    #[derive(Clone)]
    pub struct UserKeyPairAgent {
        variant: AgentVariant,
    }

    #[derive(Clone)]
    enum AgentVariant {
        /// Client variant - holds private key for signing
        Client { signing_key: Arc<SigningKey> },
        /// Server variant - holds root context for system queries (lazy-initialized)
        Server {
            root_context: Arc<OnceCell<Context>>,
        },
    }

    impl UserKeyPairAgent {
        /// Create a client agent with a signing key
        pub fn new_client(signing_key: SigningKey) -> Self {
            Self {
                variant: AgentVariant::Client {
                    signing_key: Arc::new(signing_key),
                },
            }
        }

        /// Create a server agent (root context will be lazily initialized)
        pub fn new_server() -> Self {
            Self {
                variant: AgentVariant::Server {
                    root_context: Arc::new(OnceCell::new()),
                },
            }
        }

        /// Initialize the root context for server agent (must be called after node creation)
        pub fn initialize_root_context<SE: StorageEngine + Send + Sync + 'static>(
            &self,
            node: Node<SE, Self>,
        ) {
            if let AgentVariant::Server { root_context } = &self.variant {
                let _ = root_context.set(Context::new(node, MyContextData::Root));
            }
        }

        /// Get root context for server operations (panics if not initialized)
        fn get_root_context(&self) -> &Context {
            if let AgentVariant::Server { root_context } = &self.variant {
                root_context
                    .get()
                    .expect("Root context not initialized - call initialize_root_context first")
            } else {
                panic!("get_root_context called on non-client variant")
            }
        }
    }

    #[async_trait]
    impl PolicyAgent for UserKeyPairAgent {
        type ContextData = MyContextData;

        fn sign_request<SE: StorageEngine, C>(
            &self,
            _node: &NodeInner<SE, Self>,
            cdata: &C,
            request: &proto::NodeRequest,
        ) -> Vec<proto::AuthData>
        where
            C: Iterable<Self::ContextData>,
        {
            match &self.variant {
                AgentVariant::Client { signing_key } => {
                    // Should only have one context data item
                    let mut auth_datas = Vec::new();
                    for ctx in cdata.iterable() {
                        match ctx {
                            MyContextData::User(user_id) => {
                                let request_bytes = serde_json::to_vec(request)
                                    .ok()
                                    .expect("Failed to serialize request");
                                let signature = signing_key.sign(&request_bytes);

                                let mut auth_data = Vec::with_capacity(80);
                                auth_data.extend_from_slice(&user_id.to_bytes());
                                auth_data.extend_from_slice(&signature.to_bytes());

                                auth_datas.push(proto::AuthData(auth_data));
                            }
                            MyContextData::Anonymous => {
                                // Anonymous context sends empty auth (for user self-registration)
                                auth_datas.push(proto::AuthData(vec![]));
                            }
                            MyContextData::Root => {
                                // Root should never be used from client
                                panic!("Root context should not be used from client");
                            }
                        }
                    }
                    auth_datas
                }
                AgentVariant::Server { .. } => vec![proto::AuthData(vec![])],
            }
        }

        async fn check_request<SE: StorageEngine, A>(
            &self,
            _node: &Node<SE, Self>,
            auth: &A,
            request: &proto::NodeRequest,
        ) -> Result<Vec<Self::ContextData>, ValidationError>
        where
            Self: Sized,
            A: Iterable<proto::AuthData> + Send + Sync,
        {
            let mut contexts = Vec::new();

            // Collect auth data first to avoid holding iterator across await
            let auth_datas: Vec<_> = auth.iterable().collect();
            for auth_data in auth_datas {
                let bytes = &auth_data.0;

                // Empty auth data means Anonymous context (used for user self-registration)
                if bytes.is_empty() {
                    info!("Empty auth data - allowing as Anonymous context");
                    contexts.push(MyContextData::Anonymous);
                    continue;
                }

                if bytes.len() < 80 {
                    info!(
                        "Insufficient auth data: got {} bytes, expected 80. Request: {:?}",
                        bytes.len(),
                        request.body
                    );
                    return Err(ValidationError::ValidationFailed(format!(
                        "Insufficient auth data: got {} bytes, expected 80",
                        bytes.len()
                    )));
                }

                let user_id_bytes: [u8; 16] = bytes[..16].try_into().map_err(|_| {
                    ValidationError::ValidationFailed("Invalid user ID".to_string())
                })?;
                let user_id = proto::EntityId::from_bytes(user_id_bytes);
                info!("Validating request for user: {}", user_id.to_base64());

                let signature_bytes: [u8; 64] = bytes[16..80].try_into().map_err(|_| {
                    ValidationError::ValidationFailed("Invalid signature".to_string())
                })?;
                let signature = Signature::from_bytes(&signature_bytes);

                // Fetch user and validate signature
                let user_view = match &self.variant {
                    AgentVariant::Server { .. } => {
                        let root_context = self.get_root_context();
                        info!("Fetching user {} with root context", user_id.to_base64());
                        let view = root_context.get::<UserView>(user_id).await.map_err(|e| {
                            ValidationError::ValidationFailed(format!("User not found: {}", e))
                        })?;
                        info!("Successfully fetched user {}", user_id.to_base64());
                        view
                    }
                    AgentVariant::Client { .. } => {
                        return Err(ValidationError::ValidationFailed(
                            "Client cannot validate requests".to_string(),
                        ));
                    }
                };

                info!(
                    "Attempting to get public key for user {}",
                    user_id.to_base64()
                );
                let pub_key_str = user_view.pub_key().map_err(|e| {
                    info!(
                        "Failed to get public key for user {}: {}",
                        user_id.to_base64(),
                        e
                    );
                    ValidationError::ValidationFailed(format!("Failed to get public key: {}", e))
                })?;
                info!(
                    "Got public key for user {}: {}",
                    user_id.to_base64(),
                    pub_key_str
                );
                let pub_key_bytes = base64::decode(&pub_key_str).map_err(|e| {
                    ValidationError::ValidationFailed(format!("Invalid public key encoding: {}", e))
                })?;
                let verifying_key_bytes: [u8; 32] =
                    pub_key_bytes.as_slice().try_into().map_err(|_| {
                        ValidationError::ValidationFailed("Invalid public key length".to_string())
                    })?;
                let verifying_key =
                    VerifyingKey::from_bytes(&verifying_key_bytes).map_err(|e| {
                        ValidationError::ValidationFailed(format!("Invalid public key: {}", e))
                    })?;

                let request_bytes = serde_json::to_vec(request).map_err(|e| {
                    ValidationError::ValidationFailed(format!("Failed to serialize request: {}", e))
                })?;

                verifying_key
                    .verify(&request_bytes, &signature)
                    .map_err(|e| {
                        ValidationError::ValidationFailed(format!(
                            "Signature verification failed: {}",
                            e
                        ))
                    })?;

                contexts.push(MyContextData::User(user_id));
            }

            Ok(contexts)
        }

        fn check_event<SE: StorageEngine>(
            &self,
            _node: &Node<SE, Self>,
            cdata: &Self::ContextData,
            _entity_before: &Entity,
            entity_after: &Entity,
            _event: &proto::Event,
        ) -> Result<Option<proto::Attestation>, AccessDenied> {
            info!(
                "check_event called: cdata={:?}, collection={}",
                cdata,
                entity_after.collection().as_str()
            );

            // Root context bypasses all checks (server-side system operations only)
            if matches!(cdata, MyContextData::Root) {
                info!("Bypassing checks for Root context");
                return Ok(None);
            }

            // Anonymous context can only create User entities (self-registration)
            if matches!(cdata, MyContextData::Anonymous) {
                if entity_after
                    .collection()
                    .as_str()
                    .eq_ignore_ascii_case("user")
                {
                    info!("Allowing User entity operation for Anonymous context");
                    return Ok(None);
                } else {
                    info!(
                        "Denying operation on {} for Anonymous context",
                        entity_after.collection().as_str()
                    );
                    return Err(AccessDenied::ByPolicy(
                        "Anonymous context can only create User entities",
                    ));
                }
            }

            // Authenticated users: validate Message ownership
            if entity_after
                .collection()
                .as_str()
                .eq_ignore_ascii_case("message")
            {
                if let MyContextData::User(authenticated_user) = cdata {
                    if let Some(Value::String(message_user)) = entity_after.value("user") {
                        let message_user_id = proto::EntityId::from_base64(&message_user)
                            .map_err(|_| AccessDenied::ByPolicy("Invalid user ID in message"))?;

                        if &message_user_id != authenticated_user {
                            return Err(AccessDenied::ByPolicy("Message user mismatch"));
                        }
                    }
                }
            }

            Ok(None)
        }

        fn validate_received_event<SE: StorageEngine>(
            &self,
            _node: &Node<SE, Self>,
            _received_from_node: &proto::EntityId,
            _event: &Attested<proto::Event>,
        ) -> Result<(), AccessDenied> {
            Ok(())
        }

        fn attest_state<SE: StorageEngine>(
            &self,
            _node: &Node<SE, Self>,
            _state: &proto::EntityState,
        ) -> Option<proto::Attestation> {
            None
        }

        fn validate_received_state<SE: StorageEngine>(
            &self,
            _node: &Node<SE, Self>,
            _received_from_node: &proto::EntityId,
            _state: &Attested<proto::EntityState>,
        ) -> Result<(), AccessDenied> {
            Ok(())
        }

        fn can_access_collection<C>(
            &self,
            _data: &C,
            _collection: &proto::CollectionId,
        ) -> Result<(), AccessDenied>
        where
            C: Iterable<Self::ContextData>,
        {
            Ok(())
        }

        fn check_read<C>(
            &self,
            _data: &C,
            _id: &proto::EntityId,
            _collection: &proto::CollectionId,
            _state: &proto::State,
        ) -> Result<(), AccessDenied>
        where
            C: Iterable<Self::ContextData>,
        {
            Ok(())
        }

        fn check_read_event<C>(
            &self,
            _data: &C,
            _event: &Attested<proto::Event>,
        ) -> Result<(), AccessDenied>
        where
            C: Iterable<Self::ContextData>,
        {
            Ok(())
        }

        fn check_write(
            &self,
            _data: &Self::ContextData,
            _entity: &Entity,
            _event: Option<&proto::Event>,
        ) -> Result<(), AccessDenied> {
            Ok(())
        }

        fn validate_causal_assertion<SE: StorageEngine>(
            &self,
            _node: &Node<SE, Self>,
            _peer_id: &proto::EntityId,
            _head_relation: &proto::CausalAssertion,
        ) -> Result<(), AccessDenied> {
            Ok(())
        }

        fn filter_predicate<C>(
            &self,
            _data: &C,
            _collection: &proto::CollectionId,
            predicate: ankurah::ankql::ast::Predicate,
        ) -> Result<ankurah::ankql::ast::Predicate, AccessDenied>
        where
            C: Iterable<Self::ContextData>,
        {
            Ok(predicate)
        }
    }
}

pub use policy_impl::{MyContextData, UserKeyPairAgent};
