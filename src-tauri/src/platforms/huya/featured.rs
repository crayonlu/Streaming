use crate::models::RoomCard;

pub async fn get_featured(page: u32) -> Result<Vec<RoomCard>, String> {
    super::category::get_rooms_by_category("0", None, page).await
}
