# Ideas

### 1. Full place links as inline keyboard buttons
`search_places` returns `googleMapsLinks` with separate URLs for: directions, place page, write a review, read reviews, and photos. Post these as inline keyboard URL buttons: "See photos | Read reviews | Get directions" — each tapping through to the right Google Maps page.

### 2. "Meet in the middle" for groups
Two users in a group chat share their locations. Use `compute_routes` from both origins to candidate places from `search_places`. Suggest the spot that minimizes total travel time for everyone.

### 3. Group chat support
Take the bot to group chats. Respond to @mentions so anyone in the group can ask for suggestions. Combine with "Meet in the middle" — the group agrees on a place together through the bot.
