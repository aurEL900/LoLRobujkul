# RankBot Installation & Setup Guide

Follow these steps to get your Twitch RankBot fully operational.

## 1. Twitch Integration
1. **Bot Account**: Create a dedicated Twitch account for your bot (optional but recommended).
2. **OAuth Token**: Log into the bot account and visit [twitchapps.com/tmi](https://twitchapps.com/tmi/) to generate your OAuth token. It will look like `oauth:xxxxxx`.
3. **Channel**: Decide which channel the bot should join (usually your main streaming channel).

## 2. Riot Games API (For !rank)
1. Visit the [Riot Developer Portal](https://developer.riotgames.com/).
2. Log in with your Riot account.
3. **API Key**: Copy your "Development API Key". Note that these expire every 24 hours unless you apply for a personal/production key.
4. **Region**: Ensure you know your Riot region (e.g., NA1, EUW1).

## 3. Gemini AI (For !ask)
1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Click on **Get API Key**.
3. Create a new API key in a new project.

## 4. Firebase Database (For Persistence)
1. This app uses Firebase to store your settings securely.
2. If you are running this in AI Studio, Firebase is already provisioned.
3. If moving to your own server, you will need to create a project at [console.firebase.google.com](https://console.firebase.google.com/) and download the `serviceAccountKey.json`.

## 5. Environment Variables (Secrets)
Go to the **Settings** tab in the dashboard and fill in the following:
- `TWITCH_USERNAME`: The bot's Twitch username.
- `TWITCH_OAUTH_TOKEN`: The token from Step 1.
- `TWITCH_CHANNEL`: Your channel name (without the #).
- `RIOT_API_KEY`: The key from Step 2.
- `GEMINI_API_KEY`: The key from Step 3.
- `ADMIN_PASSWORD`: A password of your choice to lock the dashboard.

## 6. Final Steps
1. **Login**: Go to the Dashboard and log in using your Google account and the `ADMIN_PASSWORD` you set.
2. **Start Bot**: Click the **Start** button on the Dashboard.
3. **Test**: Type `!rank` or `!help` in your Twitch chat to verify the bot is responding.

---
*Need help? Contact the developer or check the logs for error messages.*
