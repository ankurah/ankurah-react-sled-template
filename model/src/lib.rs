use ankurah::Model;
use serde::{Deserialize, Serialize};

#[derive(Model, Debug, Serialize, Deserialize)]
pub struct User {
    pub display_name: String,
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
