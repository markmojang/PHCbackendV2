const express = require("express");
const axios = require("axios");
const connectDB = require("./db.js");
const userModel = require("./Models/user.js");
const querystring = require("querystring");
const jwt = require("jsonwebtoken");
const PORT = process.env.PORT || 8000;
const app = express();
const stateCache = {};

connectDB();
app.use(express.json());

app.use((req, res, next) => {
  const currentTime = new Date().toISOString();
  const method = req.method;
  const path = req.originalUrl;
  console.log(`${currentTime} - ${method} - ${path}`);
  next();
});

app.listen(PORT, () => {
  console.log(`server listening on ${PORT}`);
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/login", async (req, res) => {
  const user = req.body.username;
  const pass = req.body.password;
  const data = await userModel.findOne({ username: user });
  // console.log(data);
  if (!data) return res.status(400).json({ message: "User not found" });
  if (data.password !== pass) {
    return res.status(400).json({ message: "Incorrect password" });
  }
  res.status(200).json({ message: "Login successful", username: data.username });
});

app.get("/loginDiscord", async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  if (!code) {
    return res.status(400).json({ message: "Authorization code not provided" });
  }

  try {
    // Step 1: Exchange code for access token
    const tokenResponse = await axios.post(
      "https://discord.com/api/oauth2/token",
      querystring.stringify({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: process.env.REDIRECT_URI,
        scope: "identify email guilds",
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    const { access_token, refresh_token, token_type } = tokenResponse.data;

    if (!access_token) {
      return res.status(400).json({
        message: "Failed to obtain access token",
        error: tokenResponse.data,
      });
    }

    // Step 2: Fetch user info from Discord
    const userResponse = await axios.get("https://discord.com/api/users/@me", {
      headers: {
        Authorization: `${token_type} ${access_token}`,
      },
    });

    const discordUser = userResponse.data;

    if (!discordUser.id) {
      return res.status(400).json({
        message: "Failed to fetch user from Discord",
        error: discordUser,
      });
    }

    const user = await userModel.findOne({ discord_id: discordUser.id });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }
    const token = jwt.sign({
      username: user.username,
      accessToken: access_token,
      refreshToken: refresh_token,
    }, process.env.JWT_SECRET,
      {
        expiresIn: "10h" // มาปรับได้
      });
    stateCache[state] = token;

    return res.status(200).send("Login successful");
  } catch (error) {
    console.error(
      "Error during Discord OAuth:",
      error.response?.data || error.message,
    );
    return res.status(500).json({
      message: "Internal server error",
      error: error.response?.data || error.message,
    });
  }
});

app.get("/authorizeDiscord", async (req, res) => {
  const state = req.query.state;
  if (!state) return res.status(400).json({ message: "State not provided" });
  if (!stateCache[state]) {
    return res.status(400).json({ message: "State not found" });
  }
  res.status(200).json(stateCache[state]);
  return delete stateCache[state];
});

app.get("/getUser/:username", async (req, res) => {
  const user = req.params.username;
  const data = await userModel.findOne({ username: user });
  if (!data) return res.status(400).json({ message: "User not found" });
  res.status(200).json(data);
});

app.get("/leaderBoard/:game", async (req, res) => {
  const game = req.params.game;

  // Validate game parameter
  const validGames = ['python', 'unity', 'blender', 'website'];
  if (!validGames.includes(game)) {
    return res.status(400).json({
      message: "Invalid game type. Must be one of: python, unity, blender, website"
    });
  }

  try {
    const sortQuery = {};
    sortQuery[`score.${game}`] = -1; // -1 for descending order

    const data = await userModel.find()
      .sort(sortQuery)
      .limit(100);
    console.log(data);
    if (!data || data.length === 0) {
      return res.status(404).json({ message: "No leaderboard data found" });
    }
    var leaderboard = data.map((player) => {
      return {
        id: player.id,
        username: player.username,
        score: player.score[game]
      };
    });
    res.status(200).json(leaderboard);
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
});